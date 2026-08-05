export async function GET() {
  return Response.json({
    ok: true,
    model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
    keyConfigured: Boolean(process.env.GEMINI_API_KEY)
  }, {
    headers: { "Cache-Control": "no-store" }
  });
}
