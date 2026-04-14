import "./globals.css";

export const metadata = {
  title: "Mojify Twitch Translator",
  description: "Translate Twitch usernames and user IDs quickly."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
