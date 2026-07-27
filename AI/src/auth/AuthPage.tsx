import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router";
import { Bot, Building2, LockKeyhole, Mail, Sparkles, User } from "lucide-react";
import { useAuth, type Industry } from "./AuthContext";

const industries: { label: string; value: Industry }[] = [
  { label: "Other / General", value: "OTHER" },
  { label: "Hotel", value: "HOTEL" },
  { label: "Restaurant", value: "RESTAURANT" },
  { label: "Real Estate", value: "REAL_ESTATE" },
  { label: "Hospital", value: "HOSPITAL" },
  { label: "Clinic", value: "CLINIC" },
];

export default function AuthPage() {
  const navigate = useNavigate();
  const { user, login, register } = useAuth();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState<Industry>("OTHER");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    try {
      setError("");
      setSubmitting(true);

      if (mode === "login") {
        await login(email, password);
      } else {
        await register({
          name,
          email,
          password,
          companyName,
          industry,
        });
      }

      navigate("/dashboard", {
        replace: true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#05070d] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.22),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.18),transparent_32%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:72px_72px] opacity-20" />

      <section className="relative z-10 grid min-h-screen grid-cols-1 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="hidden flex-col justify-between border-r border-white/10 p-10 lg:flex">
          <div>
            <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/70">
              <Sparkles size={16} />
              AI Communication CRM
            </div>

            <h1 className="mt-10 max-w-3xl text-5xl font-semibold tracking-[-0.06em] text-white xl:text-7xl">
              One AI front desk for calls, WhatsApp and lead handling.
            </h1>

            <p className="mt-7 max-w-xl text-lg leading-8 text-white/58">
              Any service business can run calls, WhatsApp, leads and tasks from
              one AI-powered workspace after login.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {["Calls", "WhatsApp", "Tasks"].map((item) => (
              <div
                key={item}
                className="rounded-3xl border border-white/10 bg-white/[0.04] p-5"
              >
                <p className="text-sm text-white/45">{item}</p>
                <p className="mt-3 text-2xl font-semibold">0</p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-center p-5">
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-[460px] rounded-[32px] border border-white/10 bg-white/[0.06] p-5 shadow-2xl shadow-black/40 backdrop-blur-2xl md:p-7"
          >
            <div className="mb-8 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-black">
                <Bot size={22} />
              </div>
              <div>
                <h2 className="text-xl font-semibold tracking-tight">
                  AiraDesk
                </h2>
                <p className="text-sm text-white/45">
                  {mode === "login" ? "Login to dashboard" : "Create company"}
                </p>
              </div>
            </div>

            <div className="mb-6 grid grid-cols-2 rounded-2xl bg-black/25 p-1">
              <button
                type="button"
                onClick={() => setMode("login")}
                className={`rounded-xl px-4 py-3 text-sm transition ${
                  mode === "login"
                    ? "bg-white text-black"
                    : "text-white/50 hover:text-white"
                }`}
              >
                Login
              </button>

              <button
                type="button"
                onClick={() => setMode("register")}
                className={`rounded-xl px-4 py-3 text-sm transition ${
                  mode === "register"
                    ? "bg-white text-black"
                    : "text-white/50 hover:text-white"
                }`}
              >
                Register
              </button>
            </div>

            <div className="space-y-4">
              {mode === "register" && (
                <>
                  <label className="block">
                    <span className="mb-2 block text-sm text-white/55">
                      Owner name
                    </span>
                    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4">
                      <User size={18} className="text-white/35" />
                      <input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        className="h-13 w-full bg-transparent text-sm outline-none placeholder:text-white/25"
                        placeholder="Your name"
                      />
                    </div>
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm text-white/55">
                      Company name
                    </span>
                    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4">
                      <Building2 size={18} className="text-white/35" />
                      <input
                        value={companyName}
                        onChange={(event) => setCompanyName(event.target.value)}
                        className="h-13 w-full bg-transparent text-sm outline-none placeholder:text-white/25"
                        placeholder="Your company"
                      />
                    </div>
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm text-white/55">
                      Industry
                    </span>
                    <select
                      value={industry}
                      onChange={(event) =>
                        setIndustry(event.target.value as Industry)
                      }
                      className="h-13 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm text-white outline-none"
                    >
                      {industries.map((item) => (
                        <option
                          key={item.value}
                          value={item.value}
                          className="bg-[#05070d]"
                        >
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}

              <label className="block">
                <span className="mb-2 block text-sm text-white/55">Email</span>
                <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4">
                  <Mail size={18} className="text-white/35" />
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="h-13 w-full bg-transparent text-sm outline-none placeholder:text-white/25"
                    placeholder="you@company.com"
                    type="email"
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm text-white/55">
                  Password
                </span>
                <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4">
                  <LockKeyhole size={18} className="text-white/35" />
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="h-13 w-full bg-transparent text-sm outline-none placeholder:text-white/25"
                    placeholder="••••••••"
                    type="password"
                  />
                </div>
              </label>
            </div>

            {error && (
              <div className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-6 h-13 w-full rounded-2xl bg-white font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting
                ? "Please wait..."
                : mode === "login"
                ? "Login"
                : "Create account"}
            </button>

            <p className="mt-5 text-center text-xs leading-5 text-white/35">
              Create a company account to start testing with a clean workspace.
            </p>
          </form>
        </div>
      </section>
    </main>
  );
}