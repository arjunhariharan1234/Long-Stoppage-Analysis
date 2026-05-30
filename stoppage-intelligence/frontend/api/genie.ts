/**
 * Vercel serverless function — proxies questions to a Databricks Genie space and
 * returns the structured response (prose answer + SQL + result rows).
 *
 * Env vars required (set via `vercel env add`):
 *   DATABRICKS_HOST            e.g. https://dbc-xxxx.cloud.databricks.com
 *   DATABRICKS_TOKEN           PAT or service principal token
 *   DATABRICKS_GENIE_SPACE_ID  Genie space id
 *
 * Request:  POST /api/genie  { question: string, conversation_id?: string }
 * Response: { text, sql, columns, rows, conversation_id, message_id, error? }
 */

export const config = { runtime: "nodejs" };

interface GenieAttachment {
  attachment_id: string;
  text?: { content: string };
  query?: {
    query: string;
    query_result_metadata?: { row_count: number; truncated: boolean };
    description?: string;
  };
}

interface GenieMessage {
  id: string;
  conversation_id: string;
  status: string;
  content?: string;
  attachments?: GenieAttachment[];
  error?: { error: string; type?: string } | string;
}

interface ColumnSchema {
  name: string;
  type_name?: string;
  type_text?: string;
}

interface QueryResultPayload {
  statement_response?: {
    status?: { state?: string; error?: { message?: string } };
    manifest?: { schema?: { columns?: ColumnSchema[] } };
    result?: { data_typed_array?: { values: { str?: string }[] }[]; data_array?: string[][] };
  };
}

// Adaptive polling — Genie returns fast for tiny queries (~3 s) and slow for
// complex joins (~30–40 s). We poll aggressively up-front to keep p50 latency low.
const POLL_SCHEDULE_MS = [300, 400, 500, 700, 900, 1200];
const POLL_TAIL_MS = 1500;
const MAX_POLL_MS = 60_000;

async function dbxFetch(host: string, token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${host}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  return res;
}

function isTerminal(status: string) {
  return ["COMPLETED", "FAILED", "CANCELLED", "QUERY_RESULT_EXPIRED"].includes(status);
}

async function pollMessage(host: string, token: string, spaceId: string, convId: string, msgId: string): Promise<GenieMessage> {
  const deadline = Date.now() + MAX_POLL_MS;
  let last: GenieMessage | null = null;
  let i = 0;
  while (Date.now() < deadline) {
    const res = await dbxFetch(host, token, `/api/2.0/genie/spaces/${spaceId}/conversations/${convId}/messages/${msgId}`);
    if (!res.ok) throw new Error(`Poll failed: ${res.status} ${await res.text()}`);
    last = (await res.json()) as GenieMessage;
    if (isTerminal(last.status)) return last;
    const wait = i < POLL_SCHEDULE_MS.length ? POLL_SCHEDULE_MS[i] : POLL_TAIL_MS;
    i++;
    await new Promise(r => setTimeout(r, wait));
  }
  throw new Error(`Timed out after ${MAX_POLL_MS}ms (last status: ${last?.status ?? "unknown"})`);
}

async function fetchQueryResult(host: string, token: string, spaceId: string, convId: string, msgId: string, attachmentId: string) {
  // The dedicated endpoint returns a SQL statement-style result with manifest + rows.
  const res = await dbxFetch(host, token, `/api/2.0/genie/spaces/${spaceId}/conversations/${convId}/messages/${msgId}/attachments/${attachmentId}/query-result`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Query result fetch failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as QueryResultPayload;
  const schema = data.statement_response?.manifest?.schema;
  const columns = (schema?.columns || []).map(c => c.name);
  const colTypes = (schema?.columns || []).map(c => c.type_text || c.type_name || "string");
  let rows: (string | number | null)[][] = [];
  const tArr = data.statement_response?.result?.data_typed_array;
  const aArr = data.statement_response?.result?.data_array;
  if (Array.isArray(tArr)) {
    rows = tArr.map((row: any) => (row?.values || []).map((cell: any) => (cell?.str ?? null)));
  } else if (Array.isArray(aArr)) {
    rows = aArr.map((r) => r.map((cell) => (cell == null ? null : String(cell))));
  }
  return { columns, colTypes, rows };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const host = process.env.DATABRICKS_HOST?.replace(/\/$/, "");
  const token = process.env.DATABRICKS_TOKEN;
  const spaceId = process.env.DATABRICKS_GENIE_SPACE_ID;
  if (!host || !token || !spaceId) {
    res.status(500).json({ error: "Server missing DATABRICKS_HOST / DATABRICKS_TOKEN / DATABRICKS_GENIE_SPACE_ID env vars" });
    return;
  }

  // Parse body (supports both parsed JSON and raw string).
  let body: any = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};
  const question: string = (body.question || "").trim();
  const conversationId: string | undefined = body.conversation_id;

  if (!question) {
    res.status(400).json({ error: "Missing 'question' in request body" });
    return;
  }

  try {
    let convId: string;
    let msgId: string;

    if (conversationId) {
      // Continue an existing conversation
      const r = await dbxFetch(host, token, `/api/2.0/genie/spaces/${spaceId}/conversations/${conversationId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: question }),
      });
      if (!r.ok) throw new Error(`create-message failed: ${r.status} ${await r.text()}`);
      const j = (await r.json()) as GenieMessage;
      convId = conversationId;
      msgId = j.id;
    } else {
      // Start a new conversation
      const r = await dbxFetch(host, token, `/api/2.0/genie/spaces/${spaceId}/start-conversation`, {
        method: "POST",
        body: JSON.stringify({ content: question }),
      });
      if (!r.ok) throw new Error(`start-conversation failed: ${r.status} ${await r.text()}`);
      const j = await r.json();
      convId = j.conversation_id || j.conversation?.id;
      msgId = j.message_id || j.message?.id;
      if (!convId || !msgId) throw new Error(`start-conversation missing ids: ${JSON.stringify(j).slice(0, 400)}`);
    }

    const final = await pollMessage(host, token, spaceId, convId, msgId);

    if (final.status !== "COMPLETED") {
      const err = typeof final.error === "string" ? final.error : final.error?.error;
      res.status(200).json({
        conversation_id: convId,
        message_id: msgId,
        status: final.status,
        error: err || `Genie returned status ${final.status}`,
        text: "",
        sql: "",
        columns: [],
        rows: [],
      });
      return;
    }

    // Stitch together the textual response and the first query attachment (if any).
    let text = "";
    let sql = "";
    let columns: string[] = [];
    let rows: (string | number | null)[][] = [];
    let queryDescription = "";

    if (final.attachments && final.attachments.length > 0) {
      for (const att of final.attachments) {
        if (att.text?.content) {
          text += (text ? "\n\n" : "") + att.text.content;
        }
        if (att.query && !sql) {
          sql = att.query.query;
          queryDescription = att.query.description || "";
          try {
            const qr = await fetchQueryResult(host, token, spaceId, convId, msgId, att.attachment_id);
            columns = qr.columns;
            rows = qr.rows;
          } catch (e: any) {
            text += (text ? "\n\n" : "") + `(could not fetch query result: ${e.message || String(e)})`;
          }
        }
      }
    } else if (final.content) {
      text = final.content;
    }

    res.status(200).json({
      conversation_id: convId,
      message_id: msgId,
      status: final.status,
      text,
      sql,
      query_description: queryDescription,
      columns,
      rows,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Genie call failed" });
  }
}
