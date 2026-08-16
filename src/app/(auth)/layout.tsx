export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main className="grid min-h-screen place-items-center bg-canvas p-4">{children}</main>;
}
