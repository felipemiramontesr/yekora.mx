/**
 * The two gates of the panel «Usuarios, roles y permisos» (FC 072, K-78): whether the actor may
 * change an account of the staff (T1.1) and whether it may create or edit a role and its matrix
 * (T1.2). Each one answers with the first thing that fails, in the order of its table.
 *
 * @module
 */

/** The rows of T1.1 as the machine names them. */
export type StaffMutationCode =
  | 'MUTATION_PERMITTED_200'
  | 'ACTOR_UNAUTHORIZED_403'
  | 'TARGET_ROLE_FORBIDDEN_403'
  | 'VALIDATION_OR_2FA_FAILED_400';

/**
 * T1.1 · StaffUserMutationGate(P, T, V): whether the actor may change an account of the staff.
 *
 * @param inputs - P: the actor holds `owner` or `admin`; T: every role asked is within the
 *   authority of the actor; V: the request is valid and the session has its second factor.
 * @returns The row of the table that applies.
 */
export function decideStaffMutation(inputs: {
  privileged: boolean;
  rolePermitted: boolean;
  valid: boolean;
}): StaffMutationCode {
  if (!inputs.privileged) return 'ACTOR_UNAUTHORIZED_403';
  if (!inputs.rolePermitted) return 'TARGET_ROLE_FORBIDDEN_403';
  return inputs.valid
    ? 'MUTATION_PERMITTED_200'
    : 'VALIDATION_OR_2FA_FAILED_400';
}

/** The rows of T1.2 as the machine names them. */
export type RoleMutationCode =
  | 'ROLE_MUTATION_PERMITTED_200'
  | 'OWNER_ONLY_FORBIDDEN_403'
  | 'SYSTEM_ROLE_PROTECTED_403'
  | 'TWO_FACTOR_REQUIRED_403';

/**
 * T1.2 · RoleAndPermissionMatrixGate(O, M, S, V): whether the actor may create or edit a role.
 *
 * @param inputs - O: the actor holds `owner`; M: it holds `roles:manage`; S: the target is not a
 *   role of the system; V: the session has its second factor and the payload is valid.
 * @returns The row of the table that applies.
 */
export function decideRoleMutation(inputs: {
  owner: boolean;
  manager: boolean;
  notSystem: boolean;
  valid: boolean;
}): RoleMutationCode {
  if (!inputs.owner || !inputs.manager) return 'OWNER_ONLY_FORBIDDEN_403';
  if (!inputs.notSystem) return 'SYSTEM_ROLE_PROTECTED_403';
  return inputs.valid
    ? 'ROLE_MUTATION_PERMITTED_200'
    : 'TWO_FACTOR_REQUIRED_403';
}
