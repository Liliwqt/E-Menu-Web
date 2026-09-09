import { useState, useRef, useEffect } from 'react';
import { X, ChevronRight, LayoutDashboard, TrendingUp, Boxes, ReceiptText,
  UtensilsCrossed, FileBarChart, Sparkles, Presentation, Settings2,
  HelpCircle, BookOpen, History, Sun, Moon, LogOut } from 'lucide-react';

const SECTIONS = [
  {
    id: 'getting-started',
    icon: BookOpen,
    title: 'Getting Started',
    content: [
      {
        heading: 'Welcome to E-Menu Portal',
        text: 'This app helps you manage your restaurant easily. \n\n• Track daily sales in real time.\n• Know exactly what is running out of stock.\n• Let our AI suggest ways to make more money.',
      },
      {
        heading: 'How to move around',
        text: '• On computers: Use the menu on the left side.\n• On phones: Use the buttons at the bottom of the screen.',
      }
    ],
  },
  {
    id: 'dashboard',
    icon: LayoutDashboard,
    title: 'Dashboard',
    content: [
      {
        heading: 'Where to find it',
        text: 'Look for this icon in your menu to go to the Dashboard.',
        visualIcon: LayoutDashboard,
      },
      {
        heading: 'What it does',
        text: 'The Dashboard is your daily summary.\n\n• See today\'s total sales and orders.\n• Check your Business Health Score (100 is perfect).\n• See active alerts for low stock items.',
      }
    ],
  },
  {
    id: 'analytics',
    icon: TrendingUp,
    title: 'Analytics (Sales Data)',
    content: [
      {
        heading: 'Where to find it',
        text: 'Look for this icon in your menu to open Analytics.',
        visualIcon: TrendingUp,
      },
      {
        heading: 'What it does',
        text: 'Analytics shows your deeper sales trends.\n\n• See which items sell the most.\n• Compare this week\'s sales to last week.\n• Find out your busiest hours.',
      }
    ],
  },
  {
    id: 'inventory',
    icon: Boxes,
    title: 'Inventory (Stock)',
    content: [
      {
        heading: 'Where to find it',
        text: 'Look for this icon in your menu to manage Inventory.',
        visualIcon: Boxes,
      },
      {
        heading: 'What it does',
        text: 'Keep track of what you have in stock.\n\n• Green bars mean you have plenty.\n• Red bars mean you need to buy more immediately.\n• Click any item to update the exact quantity.',
      }
    ],
  },
  {
    id: 'orders',
    icon: ReceiptText,
    title: 'Live Orders',
    content: [
      {
        heading: 'Where to find it',
        text: 'Look for this icon in your menu to see Orders.',
        visualIcon: ReceiptText,
      },
      {
        heading: 'What it does',
        text: 'Watch orders come in right now.\n\n• See what customers just bought.\n• Check if they paid with Cash or Card.\n• Click any order to see full details.',
      }
    ],
  },
  {
    id: 'menu',
    icon: UtensilsCrossed,
    title: 'Menu Management',
    content: [
      {
        heading: 'Where to find it',
        text: 'Look for this icon to change your Menu.',
        visualIcon: UtensilsCrossed,
      },
      {
        heading: 'What it does',
        text: 'Update your products and prices here.\n\n• Click any item to change its price.\n• Add new sizes (like Small or Large).\n• Turn items off if you can\'t make them today.',
      }
    ],
  },
  {
    id: 'ai-analyst',
    icon: Sparkles,
    title: 'AI Analyst',
    content: [
      {
        heading: 'Where to find it',
        text: 'Look for the "Ask AI Analyst" button at the top right of your screen.',
        visualIcon: Sparkles,
      },
      {
        heading: 'What it does',
        text: 'Your smart digital assistant.\n\n• Ask questions like "What should I prep for tomorrow?"\n• Get advice on how to improve sales.\n• The AI reads your actual store data to give real answers.',
      }
    ],
  },
  {
    id: 'reports',
    icon: FileBarChart,
    title: 'Reports',
    content: [
      {
        heading: 'Where to find it',
        text: 'Look for this icon in your menu to open Reports.',
        visualIcon: FileBarChart,
      },
      {
        heading: 'What it does',
        text: 'Printable summaries of your sales.\n\n• Generate reports for a day, week, or month.\n• Print them cleanly on paper.\n• Great for sharing with owners or accountants.',
      }
    ],
  },
  {
    id: 'order-ledger',
    icon: History,
    title: 'Order Ledger (History)',
    content: [
      {
        heading: 'Where to find it',
        text: 'Look for this icon in your menu to view the Order Ledger.',
        visualIcon: History,
      },
      {
        heading: 'What it does',
        text: 'A list of every single order.\n\n• Sort by cash or card payments.\n• See cancelled or refunded orders (crossed out).\n• Perfect for end-of-day cash drawer balancing.',
      }
    ],
  },
  {
    id: 'settings',
    icon: Settings2,
    title: 'Settings & Light/Dark Mode',
    content: [
      {
        heading: 'Account Settings',
        text: 'Click your profile initials at the bottom left (or top right on phones) to change your name or password.',
        visualIcon: Settings2,
      },
      {
        heading: 'Light or Dark Screen',
        text: 'Click the Sun or Moon icon to make the screen bright white or dark gray.',
        visualIcon: Sun,
      }
    ],
  },
];

export default function HelpCenter({ open, onClose }) {
  const [activeSection, setActiveSection] = useState('getting-started');
  const bodyRef = useRef(null);

  useEffect(() => {
    if (open && bodyRef.current) {
      bodyRef.current.scrollTop = 0;
    }
  }, [activeSection, open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const section = SECTIONS.find((s) => s.id === activeSection) || SECTIONS[0];

  return (
    <div className="modal-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="help" onClick={(e) => e.stopPropagation()}>
        {/* Sidebar nav (desktop) */}
        <aside className="help__nav">
          <div className="help__navHead">
            <HelpCircle size={18} />
            <span style={{ fontWeight: 700, fontSize: 'var(--text-md)' }}>Help Center</span>
          </div>
          <div className="help__navList">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`help__navItem ${activeSection === s.id ? 'is-active' : ''}`}
                onClick={() => setActiveSection(s.id)}
              >
                <s.icon size={16} />
                {s.title}
              </button>
            ))}
          </div>
        </aside>

        {/* Content area */}
        <div className="help__main">
          <div className="help__head">
            {/* Mobile section selector */}
            <select
              className="help__mobileSelect select"
              value={activeSection}
              onChange={(e) => setActiveSection(e.target.value)}
            >
              {SECTIONS.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
            <div className="help__headTitle">
              <section.icon size={20} style={{ color: 'var(--primary)', flexShrink: 0 }} />
              <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, margin: 0 }}>{section.title}</h2>
            </div>
            <button className="help__close" onClick={onClose} aria-label="Close Help Center">
              <X size={16} />
            </button>
          </div>

          <div className="help__body" ref={bodyRef}>
            {section.content.map((item, i) => (
              <div key={i} className="help__article">
                <h3 className="help__articleTitle">{item.heading}</h3>
                {item.visualIcon && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', margin: '16px 0', padding: '16px', background: 'var(--surface-2)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
                    <div style={{ background: 'var(--primary)', color: 'white', padding: '12px', borderRadius: '12px', display: 'flex' }}>
                      <item.visualIcon size={32} />
                    </div>
                    <span style={{ fontSize: 'var(--text-md)', fontWeight: 650, color: 'var(--text-1)' }}>Look for this icon</span>
                  </div>
                )}
                <p className="help__articleText" style={{ whiteSpace: 'pre-line' }}>{item.text}</p>
              </div>
            ))}

            {/* Navigation to adjacent sections */}
            <div className="help__adjacent">
              {SECTIONS.map((s, i) => {
                const currentIndex = SECTIONS.findIndex((x) => x.id === activeSection);
                if (i !== currentIndex - 1 && i !== currentIndex + 1) return null;
                return (
                  <button
                    key={s.id}
                    className="help__adjacentBtn"
                    onClick={() => setActiveSection(s.id)}
                  >
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', fontWeight: 600 }}>
                      {i < currentIndex ? '← Previous' : 'Next →'}
                    </span>
                    <span style={{ fontWeight: 650 }}>{s.title}</span>
                    <ChevronRight size={14} style={{ color: 'var(--text-3)' }} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
