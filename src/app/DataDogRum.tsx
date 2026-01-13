// Necessary if using App Router to ensure this file runs on the client
"use client";

import { datadogRum } from "@datadog/browser-rum";

const env = process.env.NODE_ENV;
const ddApplicationId = process.env.NEXT_PUBLIC_DATADOG_APPLICATION_ID;
const ddClientToken = process.env.NEXT_PUBLIC_DATADOG_CLIENT_TOKEN;

datadogRum.init({
  applicationId: `${ddApplicationId}`,
  clientToken: `${ddClientToken}`,
  site: "datadoghq.com",
  service: "telx-network",
  env: env,
  // Specify a version number to identify the deployed version of your application in Datadog
  // version: '1.0.0',
  sessionSampleRate: 100,
  // 👇 Disable replay when developing locally
  sessionReplaySampleRate: process.env.NODE_ENV === 'production' ? 20 : 0,
  trackUserInteractions: true,
  trackResources: true,
  trackLongTasks: true,
  defaultPrivacyLevel: "mask-user-input",
  // Specify URLs to propagate trace headers for connection between RUM and backend trace
  allowedTracingUrls: [
    { match: "https://telx.network", propagatorTypes: ["tracecontext"] },
  ],
});

export default function DatadogInit() {
  // Render nothing - this component is only included so that the init code
  // above will run client-side
  return null;
}
