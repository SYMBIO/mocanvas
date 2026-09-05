export {
  createMemoryUserStore,
  createUserId,
  isUserId,
  UserRecordType,
  userIdValidator,
  userValidator,
  type User,
  type UserId,
  type UserStore,
} from "./userRecord"

export {
  createCurrentUser,
  getFreshUserPreferences,
  USER_PREFERENCES_DEFAULTS,
  UserPreferencesManager,
  type ColorScheme,
  type CurrentUser,
  type UserPreferencesState,
} from "./userPreferences"

export { useCurrentUser, type UseCurrentUserOptions } from "./useCurrentUser"

export {
  createPresenceStateDerivation,
  trackPointer,
  type PointLike,
  type PointerSource,
  type PresenceStateDerivationOptions,
  type PresenceUser,
} from "./presence"

export {
  createTLCurrentUser,
  defaultUserPreferences,
  defaultUserStore,
  getUserPreferences,
  setUserPreferences,
  userPreferencesValidator,
  userTypeValidator,
} from "./globalPreferences"

export {
  createCachedUserResolve,
  createUserRecordType,
  getDefaultUserProperties,
  type CachedUserResolve,
  type CreateCachedUserResolveOptions,
  type UserRecordId,
} from "./userSchema"

export {
  getDefaultUserPresence,
  type CreatePresenceStateDerivationOpts,
  type TLPresenceStateInfo,
} from "./presence"
