import { LangPicker } from "@/components/I18n";
import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="center-page">
      <div className="card">
        <div className="row">
          <span className="mono solid" style={{ background: "var(--brand)" }}>A</span>
          <h1 style={{ fontSize: 22 }}>Arevalo Marketing</h1>
        </div>
        <LoginForm />
        <LangPicker />
      </div>
    </main>
  );
}
