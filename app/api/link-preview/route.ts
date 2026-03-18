import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; nLink/1.0; +https://nlink.to)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Failed to fetch URL" }, { status: 500 });
    }

    const html = await response.text();

    // Parse meta tags
    const getMetaContent = (property: string): string | null => {
      // Try og: prefix
      const ogMatch = html.match(
        new RegExp(`<meta[^>]*property=["']og:${property}["'][^>]*content=["']([^"']*)["']`, "i")
      ) || html.match(
        new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:${property}["']`, "i")
      );
      if (ogMatch) return ogMatch[1];

      // Try twitter: prefix
      const twitterMatch = html.match(
        new RegExp(`<meta[^>]*name=["']twitter:${property}["'][^>]*content=["']([^"']*)["']`, "i")
      ) || html.match(
        new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']twitter:${property}["']`, "i")
      );
      if (twitterMatch) return twitterMatch[1];

      // Try regular name attribute
      const nameMatch = html.match(
        new RegExp(`<meta[^>]*name=["']${property}["'][^>]*content=["']([^"']*)["']`, "i")
      ) || html.match(
        new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${property}["']`, "i")
      );
      if (nameMatch) return nameMatch[1];

      return null;
    };

    // Get title
    let title = getMetaContent("title");
    if (!title) {
      const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      title = titleMatch ? titleMatch[1].trim() : null;
    }

    // Get description
    const description = getMetaContent("description");

    // Get image
    let image = getMetaContent("image");
    if (image && !image.startsWith("http")) {
      // Make relative URLs absolute
      const urlObj = new URL(url);
      image = image.startsWith("/")
        ? `${urlObj.origin}${image}`
        : `${urlObj.origin}/${image}`;
    }

    // Get site name
    const siteName = getMetaContent("site_name") || new URL(url).hostname;

    return NextResponse.json({
      title: title || null,
      description: description || null,
      image: image || null,
      siteName,
      url,
    });
  } catch (error) {
    console.error("Link preview error:", error);
    return NextResponse.json({ error: "Failed to fetch metadata" }, { status: 500 });
  }
}
