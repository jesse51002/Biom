// SPDX-License-Identifier: AGPL-3.0-only
// Layer 1 — THE BUCKET A SHARED PAGE LANDS IN.
//
// Five names out of the environment and nothing else: the two AWS keys, the
// region, the bucket, and the public host the link is built on. The upload
// goes through Bun's own S3 client, so nothing is added to the dependencies.
// The key the server carries is an upload-only user with `PutObject` on this
// one bucket — `landing/deploy/provision_shares.py` in the internal repository
// mints it — and the key that provisions biom.dev never comes near here.
//
// `missing()` names the first variable that is not set, so the route can
// refuse with a sentence a person can act on before a browser is launched
// for nothing.

export interface Bucket {
  /** The first required variable that is not set, or null when all are. */
  missing(): string | null;
  /** Put `html` at `key` and answer the link a stranger opens. */
  put(key: string, html: string): Promise<string>;
}

const REQUIRED = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "BIOM_SHARE_BUCKET", "BIOM_SHARE_HOST"] as const;

export function makeBucket(env: Record<string, string | undefined>): Bucket {
  return {
    missing() {
      for (const name of REQUIRED) if (!env[name]) return name;
      return null;
    },
    async put(key, html) {
      const client = new Bun.S3Client({
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        region: env.AWS_REGION,
        bucket: env.BIOM_SHARE_BUCKET,
      });
      await client.write(key, html, { type: "text/html; charset=utf-8" });
      return `https://${env.BIOM_SHARE_HOST}/${key}`;
    },
  };
}
