import { LangPicker } from "@/components/I18n";
import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="center-page">
      <div className="card">
        <h1 className="login-name">Matya</h1>
        <LoginForm />
        <LangPicker />
      </div>
    </main>
  );
}
