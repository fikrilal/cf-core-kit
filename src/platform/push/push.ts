export const SESSION_PUSH_PLATFORMS = ["ANDROID", "IOS", "WEB"] as const;

export type SessionPushPlatform = (typeof SESSION_PUSH_PLATFORMS)[number];

export type PushPort = Readonly<{
  isEnabled: () => boolean;
}>;

export function disabledPushPort(): PushPort {
  return { isEnabled: () => false };
}
