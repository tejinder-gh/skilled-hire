# Authentication and Authorization

Bearer JWT access tokens carry only a subject ID and session version. Every request reloads roles/organization relationships and performs server-side authorization. Passwords use Argon2id. Staff and administrators require MFA in production (an enforcement flag is included in the identity model).

Authorization combines roles with resource checks: customers access only their properties/jobs; contractors only their company and staff jobs; technicians only assigned jobs; operations use scoped permissions; admin permissions are never implied by UI routing.
