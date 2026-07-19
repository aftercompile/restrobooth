/**
 * Where a denied /t/[token] scan (or a missing-cookie proxy.ts redirect)
 * lands. Deliberately plain — the message itself already carries the
 * specific-vs-vague distinction (qrToken.ts's guestTokenDenialMessage):
 * this page doesn't need to know WHY, only how to show it.
 */
export default async function InvalidPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;

  return (
    <main>
      <h1>Can&rsquo;t start your order</h1>
      <p>{message ?? "This QR code is no longer valid — please rescan the code on your table."}</p>
    </main>
  );
}
