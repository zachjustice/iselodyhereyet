declare namespace Cloudflare {
  interface Env {
    GITHUB_TOKEN: string;
    TWILIO_AUTH_TOKEN: string;
    ALLOWED_PHONE: string;
    SYNC_AUTH_TOKEN: string;
    GITHUB_OWNER: string;
    GITHUB_REPO: string;
    GITHUB_BRANCH: string;
    GITHUB_FILE_PATH: string;
    NOTES_FILE_PATH: string;
    IMAGES_BUCKET: R2Bucket;
  }
}
