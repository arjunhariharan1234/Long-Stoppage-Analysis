import axios from "axios";

const api = axios.create({
  baseURL:
    import.meta.env.VITE_API_URL ||
    (window.location.hostname === "localhost"
      ? "http://localhost:8000/api"
      : "https://stoppage-intelligence-api.onrender.com/api"),
});

export default api;
