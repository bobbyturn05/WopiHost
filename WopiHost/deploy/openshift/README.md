# OpenShift deployment

1. Build and push the image from the project root:

   ```sh
   podman build -t image-registry.example.com/project/wopi-host:1.0.0 .
   podman push image-registry.example.com/project/wopi-host:1.0.0
   ```

2. Create the secret outside source control. It must contain these keys:

   - `MONGODB_URI`
   - `INTERNAL_SERVICE_TOKEN` (at least 32 characters)
   - `MINIO_ACCESS_KEY`
   - `MINIO_SECRET_KEY`
   - `WOPI_FILE_ID_SECRET` (stable, random, at least 32 characters)

   Example (supply values from your secret manager, do not commit them):

   ```sh
   oc create secret generic wopi-host-secrets \\
     --from-literal=MONGODB_URI='...' \\
     --from-literal=INTERNAL_SERVICE_TOKEN='...' \\
     --from-literal=MINIO_ACCESS_KEY='...' \\
     --from-literal=MINIO_SECRET_KEY='...' \\
     --from-literal=WOPI_FILE_ID_SECRET='...'
   ```

3. Replace the example image, public hostname, MinIO endpoint, Office discovery URL/origins, and bucket name in the manifests. Keep `PUBLIC_WOPI_ORIGIN` identical to the public Route origin.

4. Apply:

   ```sh
   oc apply -f deploy/openshift/configmap.yaml
   oc apply -f deploy/openshift/deployment.yaml
   oc apply -f deploy/openshift/service.yaml
   oc apply -f deploy/openshift/route.yaml
   oc apply -f deploy/openshift/route-launch.yaml
   oc apply -f deploy/openshift/pdb.yaml
   ```

5. Grant the MinIO identity `s3:ListBucket` and `s3:GetBucketVersioning` on each configured bucket, plus `s3:GetObject`, `s3:GetObjectVersion`, `s3:PutObject`, `s3:GetObjectTagging`, `s3:GetObjectVersionTagging`, and `s3:PutObjectTagging` on the required object prefixes. Enable bucket versioning before the first write using separate provisioning/admin credentials (the `enable-minio-versioning.sh` script uses the supplied credentials for that purpose). At the bucket-configuration level, the runtime application identity should have only `s3:GetBucketVersioning`; do not grant it `s3:PutBucketVersioning` or other bucket-administration actions.

The deployment uses two replicas and requires MongoDB indexes to be created before rollout. The readiness probe checks a live MongoDB ping, the required MongoDB indexes, Office discovery initialization, and HeadBucket plus enabled-versioning status for every configured MinIO bucket. The liveness probe only checks that the process is responsive.

The public Routes expose only `/wopi` and `/launch`. They deliberately do not expose `/internal` or `/health`. The main backend should call the ClusterIP Service directly (for example, `http://wopi-host:3100/internal/presign`) from inside the cluster. Keep the service token guard as defense in depth. If the backend is outside the cluster, create a separate private route reachable only over your private network; do not add `/internal` to the public Routes. The WOPI Route has a three-minute HAProxy timeout to accommodate bounded document saves; the launch Route has a shorter timeout. The Deployment has a 210-second termination grace period. The sample Routes assume TLS termination at the OpenShift router. If your cluster uses passthrough or re-encrypt termination, adjust the Routes and public-origin configuration accordingly.
