import { configuredWecomProvider, completeWecom } from '@/modules/identity/wecom';
import { cookieValue } from '@/modules/identity/session';
import { authResponse, endpoint, setCookie } from '@/modules/identity/http';
export async function GET(request: Request) {
  return endpoint(async () => {
    const params = new URL(request.url).searchParams;
    const result = await completeWecom(params.get('state') ?? '', cookieValue(request, 'agri_wecom_state'), params.get('code') ?? '', configuredWecomProvider());
    const response = authResponse(result);
    // Fixed relative destination; no browser-supplied return URL.
    response.headers.set('Location', result.kind === 'mfa' ? '/login?step=mfa' + (result.enrollment ? '&enroll=1' : '') : '/account');
    setCookie(response, 'agri_wecom_state', '', 0);
    return new Response(null, { status: 303, headers: response.headers });
  });
}
