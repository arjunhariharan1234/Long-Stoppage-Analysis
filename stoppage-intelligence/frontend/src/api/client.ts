import axios from "axios";

const api = axios.create({
  baseURL:
    import.meta.env.VITE_API_URL ||
    (window.location.hostname === "localhost"
      ? "http://localhost:8000/api"
      : "/api"),  // Will be set via VITE_API_URL env var in Vercel for Railway backend
});

export default api;
