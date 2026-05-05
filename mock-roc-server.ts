/**
 * Mock ROC server for development and testing.
 * Listens on port 9000 and responds to representLprEx requests
 * with realistic fake license plate data.
 *
 * Run: npx ts-node mock-roc-server.ts
 */
import * as http from 'http';
import { Request, Response, Template, Detection, Pose } from './roc';

const PORT = 9000;

const MOCK_PLATES = [
  { text: 'ABC-1234', region: 'North American', quality: 0.97 },
  { text: 'XYZ-5678', region: 'North American', quality: 0.88 },
  { text: 'TN-4521-AB', region: 'European', quality: 0.91 },
];

function makeMockDetection(x: number, y: number, w: number, h: number): Detection {
  return {
    x,
    y,
    width: w,
    height: h,
    rotation: 0,
    confidence: 0.95 + Math.random() * 0.04,
    pose: Pose.ROC_POSE_FRONTAL,
    imageWidth: 1280,
    imageHeight: 720,
  };
}

function makeMockTemplate(plate: { text: string; region: string; quality: number }): Template {
  const md = JSON.stringify({
    text: plate.text,
    region: plate.region,
    quality: plate.quality,
    confidence: 0.94 + Math.random() * 0.05,
  });

  // 4x4 minimal PNG in bytes as a fake thumbnail
  const fakeThumbnail = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAABmJLR0QA/wD/AP+gvaeTAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII=',
    'base64',
  );

  return {
    detection: makeMockDetection(
      100 + Math.random() * 400,
      80 + Math.random() * 200,
      200 + Math.random() * 100,
      60 + Math.random() * 30,
    ),
    templateId: `mock-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    personId: '',
    timestamp: BigInt(Date.now()),
    mediaId: '',
    cameraId: '',
    archiveId: '',
    modality: 2, // LPR modality
    md,
    fv: new Uint8Array(0),
    tn: new Uint8Array(fakeThumbnail),
    majorVersion: 1,
    minorVersion: 0,
    magicNumber: 0,
    ba: new Uint8Array(0),
    algorithmId: 0,
  };
}

const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];

  req.on('data', (chunk) => chunks.push(chunk));

  req.on('end', () => {
    try {
      const body = Buffer.concat(chunks);
      const rocRequest = Request.fromBinary(new Uint8Array(body));
      const kind = rocRequest.requests.oneofKind;

      console.log(`[mock-roc] Received request: ${kind}`);

      let rocResponse: Response;

      if (kind === 'representLprEx') {
        // Pick 1-2 random plates from mock data
        const count = 1 + Math.floor(Math.random() * 2);
        const templates = MOCK_PLATES.slice(0, count).map(makeMockTemplate);

        rocResponse = {
          responses: {
            oneofKind: 'representLprEx',
            representLprEx: { templates },
          },
        };

        console.log(`[mock-roc] Returning ${count} mock plate(s): ${templates.map(t => JSON.parse(t.md).text).join(', ')}`);

      } else if (kind === 'size') {
        // Health ping
        rocResponse = {
          responses: {
            oneofKind: 'size',
            size: { size: BigInt(0) },
          },
        };
        console.log('[mock-roc] Responding to size (health) ping');

      } else {
        rocResponse = {
          responses: {
            oneofKind: 'error',
            error: { error: `Unsupported request type: ${kind}` },
          },
        };
        console.warn(`[mock-roc] Unsupported request kind: ${kind}`);
      }

      const responseBytes = Response.toBinary(rocResponse);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(Buffer.from(responseBytes));

    } catch (err) {
      console.error('[mock-roc] Parse error:', err.message);
      res.writeHead(400);
      res.end();
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n[mock-roc] Mock ROC server running on http://localhost:${PORT}`);
  console.log('[mock-roc] Supports: representLprEx, size (health ping)');
  console.log('[mock-roc] Ready to receive ALPR requests\n');
});
