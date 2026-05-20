import type { BrokerCode } from "@/service/types/broker";

export type BrokerGuide = {
  broker: BrokerCode;
  title: string;
  summary: string;
  required: string[];
  setupSteps: string[];
  formMapping: { label: string; field: string; note: string }[];
  sessionSteps: string[];
  notes: string[];
};

export const brokerGuides: Record<BrokerCode, BrokerGuide> = {
  angel: {
    broker: "angel",
    title: "Angel One SmartAPI Setup",
    summary: "Connect Angel One by creating a SmartAPI app and pairing the app key with your Angel client code.",
    required: ["Account label", "API key", "Client code", "PIN"],
    setupSteps: [
      "Create or open your Angel One SmartAPI developer app.",
      "Copy the API key from the app credentials.",
      "Keep your Angel One client code and PIN ready.",
      "Use a 6-digit TOTP during session login. Store the TOTP secret only if you want automation later."
    ],
    formMapping: [
      { label: "API key", field: "api_key", note: "SmartAPI application key." },
      { label: "Client code", field: "client_code", note: "Angel One user or client ID." },
      { label: "PIN", field: "pin", note: "Angel One login PIN. Stored encrypted by the backend." },
      { label: "TOTP secret", field: "totp_secret", note: "Optional automation secret, not the current 6-digit OTP." }
    ],
    sessionSteps: [
      "Open the broker detail page after saving credentials.",
      "Enter client code, PIN, and the current 6-digit TOTP.",
      "Submit the session form to generate broker session tokens."
    ],
    notes: ["TOTP inputs are current one-time codes; TOTP secret is for automated generation."]
  },
  dhan: {
    broker: "dhan",
    title: "Dhan API Setup",
    summary: "Connect Dhan with API key, API secret, and your Dhan client ID.",
    required: ["Account label", "API key", "API secret", "Client ID"],
    setupSteps: [
      "Create API credentials in your Dhan API or developer console.",
      "Copy the API key and API secret.",
      "Copy your Dhan client ID from your account profile.",
      "Set up TOTP and static IP whitelisting if your account requires them for live API access."
    ],
    formMapping: [
      { label: "API key", field: "app_id", note: "Sent to the backend as app_id." },
      { label: "API secret", field: "app_secret", note: "Sent to the backend as app_secret." },
      { label: "Client ID", field: "client_id", note: "Your Dhan client ID." },
      { label: "PIN", field: "pin", note: "Optional 6-digit login PIN for automation." },
      { label: "TOTP secret", field: "totp_secret", note: "Optional QR/authenticator secret for automation." }
    ],
    sessionSteps: [
      "Use the broker detail page to start the Dhan consent flow.",
      "Complete Dhan login and 2FA in the opened page.",
      "Paste the returned token_id into the Dhan session form."
    ],
    notes: ["Static IP whitelisting may be required by Dhan before live API calls work."]
  },
  groww: {
    broker: "groww",
    title: "Groww Trade API Setup",
    summary: "Add Groww with API approval, TOTP automation, or a manual access token.",
    required: ["Account label", "One Groww credential mode"],
    setupSteps: [
      "Open the Groww Trade API key dashboard.",
      "Add or update the mandatory static IP.",
      "Choose API approval, TOTP, or access token mode.",
      "Enter only the fields required for that mode.",
      "Save the broker account."
    ],
    formMapping: [
      { label: "API key", field: "api_key", note: "Used with API secret in approval mode." },
      { label: "API secret", field: "api_secret", note: "Used with API key in approval mode." },
      { label: "TOTP API key", field: "totp_token", note: "Groww user API key for the TOTP flow." },
      { label: "TOTP secret", field: "totp_secret", note: "Authenticator or QR secret for TOTP mode." },
      { label: "Access token", field: "access_token", note: "Current token for manual mode." }
    ],
    sessionSteps: [
      "Save the broker account with one valid credential mode.",
      "Use the broker detail page to refresh or submit the session depending on the configured mode.",
      "For manual token mode, paste a fresh access token when the old one expires."
    ],
    notes: [
      "Static IP is mandatory for Groww API access.",
      "API approval is the normal official setup, TOTP is best for automation, and access token is best for quick manual testing."
    ]
  },
  indmoney: {
    broker: "indmoney",
    title: "INDmoney Token Setup",
    summary: "Connect INDmoney with a manually generated bearer access token.",
    required: ["Account label", "Access token"],
    setupSteps: [
      "Open the INDstocks API trading page.",
      "Generate or copy a fresh INDmoney bearer access token.",
      "Set up static IP allowlisting if INDmoney requires it.",
      "Paste the access token into Market Stack."
    ],
    formMapping: [
      { label: "Access token", field: "access_token", note: "Paste only the token value, not the word Bearer." }
    ],
    sessionSteps: [
      "Save the account with an access token.",
      "If the token expires, open the broker detail page and paste a fresh token into the INDmoney session form."
    ],
    notes: [
      "Treat access tokens like passwords.",
      "INDmoney is manual-token only in Market Stack right now; there is no automated login or TOTP flow."
    ]
  },
  kotak: {
    broker: "kotak",
    title: "Kotak Neo Setup",
    summary: "Connect Kotak Neo with UCC and portal access token, then use mobile/TOTP/MPIN for sessions.",
    required: ["Account label", "UCC", "Portal access token"],
    setupSteps: [
      "Open your Kotak Neo developer or API portal.",
      "Copy your UCC or client code.",
      "Generate and copy the portal access token.",
      "Keep registered mobile number, MPIN, and TOTP ready for session login."
    ],
    formMapping: [
      { label: "UCC", field: "ucc", note: "Unique Client Code for Kotak." },
      { label: "Portal access token", field: "portal_access_token", note: "Bearer token from Kotak Neo developer portal." },
      { label: "Mobile number", field: "mobile_number", note: "Optional at creation; required during session login." },
      { label: "MPIN", field: "mpin", note: "Optional at creation; used for session login or automation." },
      { label: "TOTP secret", field: "totp_secret", note: "Optional automation secret." }
    ],
    sessionSteps: [
      "Open the broker detail page after account creation.",
      "Enter registered mobile number, current 6-digit TOTP, and MPIN.",
      "Submit the session form to create a trading session."
    ],
    notes: ["Portal access token and trade session credentials are separate pieces of the Kotak flow."]
  },
  upstox: {
    broker: "upstox",
    title: "Upstox OAuth Setup",
    summary: "Connect Upstox with API key, API secret, and an exact redirect URI match.",
    required: ["Account label", "API key", "API secret", "Redirect URI"],
    setupSteps: [
      "Create an Upstox developer app.",
      "Copy the API key and API secret.",
      "Set the redirect URI to http://localhost:3000/broker-connections for local development.",
      "Save the exact same redirect URI in Market Stack."
    ],
    formMapping: [
      { label: "API key", field: "api_key", note: "Upstox client ID or API key." },
      { label: "API secret", field: "api_secret", note: "Upstox API secret." },
      { label: "Redirect URI", field: "redirect_uri", note: "Use http://localhost:3000/broker-connections locally; it must match Upstox exactly." }
    ],
    sessionSteps: [
      "Save the account, then open the broker detail page.",
      "Open the Upstox login URL from the session panel.",
      "After authorization, Market Stack reads the code from /broker-connections and connects the account automatically."
    ],
    notes: ["Use http://localhost:3000 before and after broker login."]
  },
  zerodha: {
    broker: "zerodha",
    title: "Zerodha Kite Connect Setup",
    summary: "Create a Kite Connect app, save the API key and secret, then authorize Zerodha from Market Stack.",
    required: ["Account label", "API key", "API secret"],
    setupSteps: [
      "Create or open your Kite Connect app.",
      "Copy the API key and API secret.",
      "Set the app redirect URL to http://localhost:3000/broker-connections for local development.",
      "Save the credentials in Market Stack."
    ],
    formMapping: [
      { label: "API key", field: "api_key", note: "Kite Connect API key." },
      { label: "API secret", field: "api_secret", note: "Kite Connect API secret." }
    ],
    sessionSteps: [
      "Open the broker detail page after saving credentials.",
      "Open the Zerodha login URL shown in the session panel.",
      "After authorization, Market Stack reads the request_token from /broker-connections and connects the account automatically."
    ],
    notes: ["Use http://localhost:3000 before and after broker login."]
  }
};

export function getBrokerGuide(broker: string): BrokerGuide | null {
  return broker in brokerGuides ? brokerGuides[broker as BrokerCode] : null;
}
