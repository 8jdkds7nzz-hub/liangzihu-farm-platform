export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(
    { status: 'ok', service: 'liangzihu-farm-platform' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
