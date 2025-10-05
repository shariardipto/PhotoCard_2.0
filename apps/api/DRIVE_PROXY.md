Google Drive proxy setup

This project can optionally stream Google Drive files server-side using a service account. This is useful when Drive share links return an HTML preview instead of raw file bytes.

How it works

- Set the environment variable `GOOGLE_SERVICE_ACCOUNT_JSON` in the API container to the contents of a Google service account JSON key (stringified JSON).
- When calling the API `/download` endpoint, add the query `drive=1` to force the API to try the Drive API streaming path.

Example:

GET /download?url=https://drive.google.com/file/d/FILE_ID/view&drive=1&filename=photo.png

Security notes

- Do NOT commit service account JSON into source control.
- In production, provide the JSON via a secret manager, Docker secret, or environment variable injection.

Creating a service account key (quick):

1. Go to Google Cloud Console → IAM & Admin → Service Accounts.
2. Create a service account and grant it the role "Drive API Reader" or appropriate least-privilege role that allows file reading.
3. Create a JSON key and copy its full contents into the `GOOGLE_SERVICE_ACCOUNT_JSON` environment variable in your container.

Docker Compose example (do not paste actual secret into repo):

services:
  api:
    environment:
      - GOOGLE_SERVICE_ACCOUNT_JSON=${GOOGLE_SERVICE_ACCOUNT_JSON}

Now the `/download?drive=1` route will attempt to stream files via the Drive API.
