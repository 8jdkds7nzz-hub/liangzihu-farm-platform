import { login } from '@/modules/identity/session';
import { assertOrigin, authResponse, endpoint, readJson, textField } from '@/modules/identity/http';
export async function POST(request: Request) {
  return endpoint(async () => {
    assertOrigin(request);
    const body = await readJson(request);
    return authResponse(await login(textField(body, 'username'), textField(body, 'password')));
  });
}
