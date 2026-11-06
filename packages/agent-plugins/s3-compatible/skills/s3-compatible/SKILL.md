---
name: s3-compatible
description: Publish the site's static export to S3-compatible storage (AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces, Wasabi, MinIO, ...) with the workspace's own saved access key. Covers what the person sets up first, the credential fields, and what each failure means in plain words.
---

# S3-compatible storage

## Connection card

Choose the card yourself from its `usedFor` list. Reuse a saved key or working sign-in for that
task. Never offer a replacement unless the person asks.

Open the plugin’s **Connect S3-compatible storage** card through the host. It collects the bucket, region, endpoint, access key ID, public URL and masked secret access key, plus optional private-media settings. Scope the key to the selected bucket. Key creation belongs to your storage provider’s console; no single key-creation URL covers all compatible services.

The steps are the same for every host: `deployment_get_static_publish_capabilities` shows whether a
credential is saved, `deployment_preview_static_publish` comes first, and `deployment_execute_static_publish`
publishes once the person confirms. `ok: "partial"` means not reachable yet: never call it failed or live.
This file is what is particular to S3-compatible storage.

- **Set up first, by the person:** a bucket they already created, public access or hosting in front of
  it, and an access key limited to that bucket. The host creates none of these. Offer the exact steps and
  bucket policy for their provider; they apply them in the provider's console.
- **Credential:** access key ID and secret access key, plus bucket, region and public URL, all saved
  together through the plugin card above. Endpoint is only for non-AWS providers (R2, B2, Spaces,
  Wasabi, MinIO); plain AWS S3 leaves it blank.
- **Public URL:** the address people visit. The host checks it after every publish and reports it plainly
  if it does not answer.
- **Old files:** the host keeps a manifest of the files it published, and removes only those that are no
  longer in the site. Other objects in the bucket are never touched.
- **Security headers:** S3 static hosting has no header config, so none are sent.

## Failure messages and what to tell the person

| Message | Meaning | Next step |
|---|---|---|
| `Failed to upload '...' to S3-compatible storage: HTTP 403` | The key cannot write to that bucket. | Check the key's bucket permissions, the bucket name and the region. |
| `Failed to upload '...' ... HTTP 404` | The bucket does not exist at that endpoint. | Check the bucket name, region and endpoint. |
| `... host-managed object manifest ...` | The host could not read or update its list of published files, so it stopped rather than guess. | Retry once; if it repeats, check the key can read and write the bucket. |
| `Concurrent publish detected ...` | Another publish changed the bucket at the same time. | Publish again. |
