export type PortalRole = 'user' | 'doctor' | 'admin'

/** 允许自助注册的身份 */
export type RegistrableRole = Extract<PortalRole, 'user' | 'doctor'>

export interface PortalSessionPayload {
  role: PortalRole
  account: string
  /** user / admin：自增 id */
  userId?: number
  /** doctor：医师执照号（主键） */
  licenseCode?: string
  iat: number
}
