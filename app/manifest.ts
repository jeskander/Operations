import type { MetadataRoute } from "next";

/** Lets Operations be installed to the home screen and open as its own app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Operations",
    short_name: "Operations",
    description: "Steps, tips, videos and knowledge for every operation.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F1F1EF",
    theme_color: "#F1F1EF",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
