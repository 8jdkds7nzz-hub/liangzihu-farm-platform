import { CHALLENGE_COOKIE, cookieValue, enrollment } from '@/modules/identity/session';
import { assertOrigin, endpoint, json } from '@/modules/identity/http';
export async function POST(request: Request) {
  return endpoint(async () => {
    assertOrigin(request);
    return json(await enrollment(cookieValue(request, CHALLENGE_COOKIE)));
  });
}
