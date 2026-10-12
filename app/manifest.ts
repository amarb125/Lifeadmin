import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LifePilot",
    short_name: "LifePilot",
    description: "Your AI life-admin assistant. Say what needs doing; LifePilot plans, reminds and follows up.",
    start_url: "/",
    display: "standalone",
    background_color: "#F5F2EC",
    theme_color: "#141B2D",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
