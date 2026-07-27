import { NavLink, useLocation, useNavigate } from "react-router";
import {
  Bell,
  Bot,
  Brain,
  CheckCircle2,
  Command,
  Filter,
  Inbox,
  LayoutDashboard,
  LineChart,
  Search,
  Settings,
  Sparkles,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import CommandCenter from "./commandcenter";
import InboxPage from "./inbox";
import CustomersPage from "./customers";
import TasksPage from "./tasks";
import SettingsPage from "./settings";
import ReportsPage from "./reports";
import TeamPage from "./team";
import AiCeoChat from "./aiCeoChat";

type Section =
  | "Dashboard"
  | "Inbox"
  | "Leads"
  | "Tasks"
  | "Team"
  | "Reports"
  | "Settings"
  | "AI CEO";

type NavItem = {
  label: Section;
  icon: LucideIcon;
  path: string;
  count: number;
};

const navItems: NavItem[] = [
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    path: "/dashboard",
    count: 0,
  },
  {
    label: "Inbox",
    icon: Inbox,
    path: "/inbox",
    count: 0,
  },
  {
    label: "Leads",
    icon: UsersRound,
    path: "/leads",
    count: 0,
  },
  {
    label: "Tasks",
    icon: CheckCircle2,
    path: "/tasks",
    count: 0,
  },
  {
    label: "Team",
    icon: Bot,
    path: "/team",
    count: 0,
  },
  {
    label: "Reports",
    icon: LineChart,
    path: "/reports",
    count: 0,
  },
  {
    label: "Settings",
    icon: Settings,
    path: "/settings",
    count: 0,
  },
];

const sectionByPath: Record<string, Section> = {
  "/dashboard": "Dashboard",
  "/command-center": "Dashboard",

  "/inbox": "Inbox",
  "/whatsapp": "Inbox",
  "/calls": "Inbox",

  "/leads": "Leads",
  "/customers": "Leads",
  "/pipeline": "Leads",
  "/handover": "Leads",
  "/bookings": "Leads",

  "/tasks": "Tasks",

  "/team": "Team",
  "/agents": "Team",

  "/reports": "Reports",
  "/analytics": "Reports",

  "/settings": "Settings",
  "/integrations": "Settings",
  "/knowledge": "Settings",
  "/outbox": "Settings",

  "/ai-ceo": "AI CEO",
};

export default function LandingPage() {
  const location = useLocation();
  const navigate = useNavigate();

  const activeSection = sectionByPath[location.pathname] || "Dashboard";

  return (
    <main className="h-screen overflow-hidden bg-[#05070d] text-white">
      <style>{`
        @keyframes auroraMove {
          0%, 100% {
            transform: translate3d(0, 0, 0) scale(1);
            opacity: 0.75;
          }
          50% {
            transform: translate3d(30px, -24px, 0) scale(1.08);
            opacity: 1;
          }
        }

        @keyframes scanLine {
          0% {
            transform: translateY(-100%);
            opacity: 0;
          }
          15% {
            opacity: 1;
          }
          100% {
            transform: translateY(100%);
            opacity: 0;
          }
        }

        @keyframes fadeUp {
          from {
            opacity: 0;
            transform: translateY(18px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .dashboard-grid {
          background-image:
            linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px);
          background-size: 48px 48px;
          mask-image: radial-gradient(circle at 50% 0%, black, transparent 72%);
        }

        .glass {
          background: linear-gradient(135deg, rgba(255,255,255,0.105), rgba(255,255,255,0.035));
          border: 1px solid rgba(255,255,255,0.11);
          box-shadow:
            0 24px 90px rgba(0,0,0,0.42),
            inset 0 1px 0 rgba(255,255,255,0.13);
          backdrop-filter: blur(24px);
        }

        .soft-card {
          background: rgba(255,255,255,0.055);
          border: 1px solid rgba(255,255,255,0.095);
          backdrop-filter: blur(18px);
        }

        .aurora {
          animation: auroraMove 8s ease-in-out infinite;
        }

        .scan-card {
          position: relative;
          overflow: hidden;
        }

        .scan-card::after {
          content: "";
          position: absolute;
          inset: 0;
          height: 45%;
          background: linear-gradient(to bottom, transparent, rgba(34,211,238,0.09), transparent);
          animation: scanLine 4.8s ease-in-out infinite;
          pointer-events: none;
        }

        .fade-up {
          animation: fadeUp 0.55s ease both;
        }

        .hidden-scroll {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }

        .hidden-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>

      <div className="pointer-events-none fixed inset-0 dashboard-grid opacity-70" />
      <div className="aurora pointer-events-none fixed left-[-160px] top-[-160px] h-[420px] w-[420px] rounded-full bg-cyan-400/20 blur-[110px]" />
      <div className="aurora pointer-events-none fixed right-[-190px] top-20 h-[500px] w-[500px] rounded-full bg-violet-500/20 blur-[130px]" />
      <div className="pointer-events-none fixed bottom-[-240px] left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-emerald-400/10 blur-[140px]" />

      <div className="relative z-10 flex h-screen overflow-hidden">
        <aside className="hidden h-screen w-[286px] shrink-0 flex-col overflow-hidden border-r border-white/10 bg-black/20 p-4 backdrop-blur-2xl xl:flex">
          <div className="glass shrink-0 rounded-[2rem] p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-black">
                <Sparkles size={22} />
              </div>

              <div>
                <p className="text-base font-semibold tracking-wide">
                  AiraDesk
                </p>
                <p className="text-xs text-white/42">AI Sales CEO</p>
              </div>
            </div>
          </div>

          <div className="hidden-scroll mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
            <nav className="space-y-2">
              {navItems.map((item) => {
                const Icon = item.icon;

                return (
                  <NavLink
                    key={item.label}
                    to={item.path}
                    className={({ isActive }) =>
                      `group flex w-full items-center justify-between rounded-2xl px-4 py-3 text-sm transition ${
                        isActive
                          ? "bg-white text-black shadow-[0_18px_50px_rgba(255,255,255,0.12)]"
                          : "text-white/55 hover:bg-white/[0.07] hover:text-white"
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span className="flex min-w-0 items-center gap-3">
                          <Icon size={18} className="shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </span>

                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            isActive
                              ? "bg-black/10 text-black"
                              : "bg-white/10 text-white/50"
                          }`}
                        >
                          {item.count}
                        </span>
                      </>
                    )}
                  </NavLink>
                );
              })}
            </nav>

            <div className="mt-5">
              <NavLink
                to="/ai-ceo"
                className={({ isActive }) =>
                  `group relative block overflow-hidden rounded-[2rem] border p-5 text-left transition hover:scale-[1.015] ${
                    isActive
                      ? "border-white bg-white text-black shadow-[0_24px_90px_rgba(255,255,255,0.12)]"
                      : "border-white/10 bg-white text-black shadow-[0_24px_90px_rgba(255,255,255,0.08)]"
                  }`
                }
              >
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(34,211,238,0.25),transparent_38%),radial-gradient(circle_at_80%_20%,rgba(168,85,247,0.22),transparent_36%)]" />

                <div className="relative z-10">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-black text-white">
                      <Brain size={22} />
                    </div>

                    <span className="flex items-center gap-2 rounded-full bg-black/10 px-3 py-1 text-xs text-black/60">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Real data
                    </span>
                  </div>

                  <h3 className="mt-5 text-lg font-semibold tracking-[-0.04em]">
                    Ask AI CEO
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-black/55">
                    Ask about leads, tasks, team, delays, missed calls and what
                    to focus on today.
                  </p>
                </div>
              </NavLink>
            </div>
          </div>
        </aside>

        <section className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
          <header className="shrink-0 border-b border-white/10 bg-[#05070d]/65 px-4 py-4 backdrop-blur-2xl md:px-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm text-cyan-200">
                  <Command size={16} />
                  Live Workspace
                </div>

                <h1 className="mt-1 text-3xl font-semibold tracking-[-0.045em] md:text-4xl">
                  {activeSection}
                </h1>
              </div>

              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <div className="soft-card flex min-w-0 items-center gap-3 rounded-2xl px-4 py-3 md:w-[360px]">
                  <Search size={18} className="shrink-0 text-white/35" />
                  <input
                    placeholder="Search leads, chats, tasks..."
                    className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/30"
                  />
                </div>

                <button className="soft-card flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm text-white/65 transition hover:bg-white/10 hover:text-white">
                  <Filter size={17} />
                  Filters
                </button>

                <button className="soft-card relative flex h-12 w-12 items-center justify-center rounded-2xl text-white/70 transition hover:bg-white/10 hover:text-white">
                  <Bell size={18} />
                </button>

                <button
                  onClick={() => navigate("/ai-ceo")}
                  className="rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:scale-[1.02]"
                >
                  Ask AI CEO
                </button>
              </div>
            </div>

            <div className="hidden-scroll mt-4 flex gap-2 overflow-x-auto pb-1 xl:hidden">
              {navItems.map((item) => {
                const Icon = item.icon;

                return (
                  <NavLink
                    key={item.label}
                    to={item.path}
                    className={({ isActive }) =>
                      `flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm ${
                        isActive
                          ? "bg-white text-black"
                          : "bg-white/[0.08] text-white/55"
                      }`
                    }
                  >
                    <Icon size={16} />
                    {item.label}
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">
                      {item.count}
                    </span>
                  </NavLink>
                );
              })}

              <NavLink
                to="/ai-ceo"
                className={({ isActive }) =>
                  `flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm ${
                    isActive
                      ? "bg-white text-black"
                      : "bg-white/[0.08] text-white/55"
                  }`
                }
              >
                <Brain size={16} />
                Ask AI CEO
              </NavLink>
            </div>
          </header>

          <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6">
            <div className="fade-up mx-auto max-w-[1700px]">
              {activeSection === "Dashboard" ? (
                <CommandCenter />
              ) : activeSection === "Inbox" ? (
                <InboxPage />
              ) : activeSection === "Leads" ? (
                <CustomersPage />
              ) : activeSection === "Tasks" ? (
                <TasksPage />
              ) : activeSection === "Team" ? (
                <TeamPage />
              ) : activeSection === "Reports" ? (
                <ReportsPage />
              ) : activeSection === "Settings" ? (
                <SettingsPage />
              ) : activeSection === "AI CEO" ? (
                <AiCeoChat />
              ) : (
                <CommandCenter />
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}