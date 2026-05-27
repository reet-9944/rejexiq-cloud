# Deploying RejexIQ to Google Cloud Run

Your application has been configured with a multi-stage `Dockerfile` which builds both your Vite frontend and Node.js Express backend, and serves them together on a single container port.

## Prerequisites

1.  **Google Cloud Account:** Ensure you have a Google Cloud project with billing enabled.
2.  **gcloud CLI:** Install and configure the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install).
3.  **MongoDB Database:** You must use a cloud-hosted MongoDB (like [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)) because local databases (e.g. `127.0.0.1:27017`) will not be accessible from inside the Cloud Run container.

## Deployment Steps

1.  Open a terminal in the root folder of your project (where this file is located).
2.  Run the following command to deploy directly from the source code. The Google Cloud Build service will automatically detect the `Dockerfile` and build it.

```bash
gcloud run deploy rejexiq-service \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="MONGO_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/rejexiq?retryWrites=true&w=majority" \
  --set-env-vars="JWT_SECRET=your_super_secret_key" \
  --set-env-vars="GCS_BUCKET_NAME=your-gcs-bucket-name"
```

**Note:** Be sure to replace `<username>`, `<password>`, `cluster0.mongodb.net`, `your_super_secret_key`, and `your-gcs-bucket-name` with your actual production values.

### What happens when you run this command?
*   It uploads your source code securely to Cloud Build.
*   Cloud Build runs the `Dockerfile`, installing dependencies and building the React app (creating the `dist` folder).
*   The final image runs your Node backend, which in turn serves your frontend statically over `PORT 8080`.
*   Cloud Run exposes the app automatically and assigns it a secure HTTPS URL.

## Important Backend Configuration Notes
*   **Port binding:** Cloud Run uses the `PORT` environment variable (defaults to `8080`). Your `server.js` is already set up to use `process.env.PORT`, so this is handled automatically.
*   **Cloud Storage for Uploads:** I've added a fallback to Google Cloud Storage. Cloud Run containers are stateless, so if you want user uploads (resumes, etc.) to persist permanently, create a GCS bucket, ensure your Cloud Run service account has Storage Admin/Object Creator roles on it, and pass its name in the `GCS_BUCKET_NAME` environment variable. If you don't pass this variable, it safely defaults back to using local disk storage (which is fine for local testing, but will clear out on container restarts in the cloud).
