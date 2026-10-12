import { LangPicker } from "@/components/I18n";
import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="center-page">
      <div className="card">
        <h1 className="login-name">Matya</h1>
        <LoginForm />
        <LangPicker />
        <p className="note"><a href="https://matya.app/privacidad/">Privacidad / Privacy</a>{" · "}<a href="https://matya.app/condiciones/">Condiciones / Terms</a>{" · "}<a href="https://matya.app/borrado-de-datos/">Borrado de datos / Data deletion</a></p>
      </div>
    </main>
  );
}
