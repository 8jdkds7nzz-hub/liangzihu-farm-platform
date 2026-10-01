import { CHALLENGE_COOKIE, SESSION_COOKIE, cookieValue, logout } from '@/modules/identity/session';
import { assertOrigin, endpoint, json, setCookie } from '@/modules/identity/http';
export async function POST(request: Request) {
  return endpoint(async () => {
    assertOrigin(request);
    await logout(cookieValue(request, SESSION_COOKIE), {}, cookieValue(request, CHALLENGE_COOKIE));
    const response = json({ ok: true });
    setCookie(response, SESSION_COOKIE, '', 0);
    setCookie(response, CHALLENGE_COOKIE, '', 0);
    return response;
  });
}
