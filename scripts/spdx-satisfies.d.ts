declare module 'spdx-satisfies' {
    export default function satisfies(expression: string, approvedLicenses: readonly string[]): boolean;
}
