import { configuredWecomProvider, startWecom } from '@/modules/identity/wecom';
import { assertOrigin, endpoint, json, setCookie } from '@/modules/identity/http';
export async function POST(request: Request) {
  return endpoint(async () => {
    assertOrigin(request);
    const result = await startWecom(configuredWecomProvider());
    const response = json({ url: result.url });
    setCookie(response, 'agri_wecom_state', result.browserToken, 300);
    return response;
  });
}
