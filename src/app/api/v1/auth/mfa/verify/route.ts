import { CHALLENGE_COOKIE, cookieValue, finishMfa } from '@/modules/identity/session';
import { assertOrigin, authResponse, endpoint, readJson, textField } from '@/modules/identity/http';
export async function POST(request: Request) {
  return endpoint(async () => {
    assertOrigin(request);
    const body = await readJson(request);
    return authResponse(await finishMfa(cookieValue(request, CHALLENGE_COOKIE), textField(body, 'code')));
  });
}
