// Balance history goes through Monarch's CSV importer: multipart upload to
// /account-balance-history/upload/ returns a session_key, parseBalanceHistory
// starts the import, and uploadBalanceHistorySession is polled to completion.
export const PARSE_BALANCE_HISTORY_Q = /* GraphQL */ `
  mutation ParseBalanceHistory($input: ParseBalanceHistoryInput!) {
    parseBalanceHistory(input: $input) { uploadBalanceHistorySession { sessionKey status errorMessage } }
  }`;
export const UPLOAD_SESSION_Q = /* GraphQL */ `
  query UploadSession($sessionKey: String!) {
    uploadBalanceHistorySession(sessionKey: $sessionKey) { sessionKey status errorMessage }
  }`;
export interface UploadSession {
  sessionKey: string;
  status: string;
  errorMessage: string | null;
}
export interface UploadSessionData {
  uploadBalanceHistorySession: UploadSession | null;
}
export interface UploadResponse {
  session_key: string;
  previews?: unknown;
}
