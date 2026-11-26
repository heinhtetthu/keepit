import { coreApi } from './core'

/** WebAuthn helpers. The browser library loads only when a passkey is used. */
export const passkeysSupported = () => typeof window !== 'undefined' && !!window.PublicKeyCredential

export async function signInWithPasskey(): Promise<{ access_token: string }> {
  const { startAuthentication } = await import('@simplewebauthn/browser')
  const { challenge_id, options } = await coreApi.account.loginOptions()
  const credential = await startAuthentication({ optionsJSON: options as any })
  return coreApi.account.loginVerify(challenge_id, credential)
}

export async function registerPasskey(name: string) {
  const { startRegistration } = await import('@simplewebauthn/browser')
  const { challenge_id, options } = await coreApi.account.registerOptions()
  const credential = await startRegistration({ optionsJSON: options as any })
  return coreApi.account.registerVerify(challenge_id, credential, name)
}
