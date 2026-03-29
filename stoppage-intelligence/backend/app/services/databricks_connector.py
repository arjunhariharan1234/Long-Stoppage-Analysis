import os
import logging
from datetime import datetime, timedelta

import pandas as pd

logger = logging.getLogger(__name__)

# Databricks SQL Warehouse connection config (from environment variables)
DATABRICKS_HOST = os.environ.get("DATABRICKS_HOST", "")
DATABRICKS_HTTP_PATH = os.environ.get("DATABRICKS_HTTP_PATH", "")
DATABRICKS_TOKEN = os.environ.get("DATABRICKS_TOKEN", "")

CUSTOMER_ID = 1182

QUERY_TEMPLATE = """
SELECT
    `t1`.`Combined Created At` AS `Combined Created At`,
    `t1`.`Trip Id` AS `Trip Id`,
    `t1`.`Unique ID` AS `Unique ID`,
    `t1`.`Route Code` AS `Route Code`,
    `zoho_alert_combined_view`.`ID` AS `zoho_alert_combined_view__ID`,
    `zoho_alert_combined_view`.`ALERT_NAME` AS `zoho_alert_combined_view__ALERT_NAME`,
    `zoho_alert_combined_view`.`CURRENT_LAT` AS `zoho_alert_combined_view__CURRENT_LAT`,
    `zoho_alert_combined_view`.`CURRENT_LONG` AS `zoho_alert_combined_view__CURRENT_LONG`
FROM `golden_layer_db`.`trip_analysis_with_api_call_v2` `t1`
FULL JOIN `golden_layer_db`.`zoho_alert_combined_view` `zoho_alert_combined_view`
    ON `t1`.`Trip Id` = `zoho_alert_combined_view`.`TRIP_ID`
WHERE
    `t1`.`Consignor Id` = {customer_id}
    AND `t1`.`Combined Created At` >= '{date_from}'
    AND `t1`.`Combined Created At` < '{date_to}'
    AND `zoho_alert_combined_view`.`ALERT_NAME` = 'Long Stoppage'
"""


def is_configured() -> bool:
    return bool(DATABRICKS_HOST and DATABRICKS_HTTP_PATH and DATABRICKS_TOKEN)


def fetch_last_n_days(
    days: int = 7,
    customer_id: int = CUSTOMER_ID,
) -> pd.DataFrame:
    """Fetch long stoppage alerts from Databricks SQL Warehouse for the last N days."""
    if not is_configured():
        raise RuntimeError(
            "Databricks SQL Warehouse not configured. Set DATABRICKS_HOST, "
            "DATABRICKS_HTTP_PATH, and DATABRICKS_TOKEN environment variables."
        )

    from databricks import sql as databricks_sql

    date_to = datetime.utcnow().strftime("%Y-%m-%d")
    date_from = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")

    query = QUERY_TEMPLATE.format(
        customer_id=customer_id,
        date_from=date_from,
        date_to=date_to,
    )

    logger.info(
        "Querying Databricks: customer=%d, range=%s to %s",
        customer_id, date_from, date_to,
    )

    connection = databricks_sql.connect(
        server_hostname=DATABRICKS_HOST,
        http_path=DATABRICKS_HTTP_PATH,
        access_token=DATABRICKS_TOKEN,
    )

    try:
        cursor = connection.cursor()
        cursor.execute(query)
        columns = [desc[0] for desc in cursor.description]
        rows = cursor.fetchall()
        cursor.close()
    finally:
        connection.close()

    df = pd.DataFrame(rows, columns=columns)
    logger.info("Fetched %d rows from Databricks", len(df))

    return df
