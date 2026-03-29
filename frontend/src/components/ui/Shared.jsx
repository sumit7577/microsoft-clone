import { clsx } from '../../lib/utils';

export function Spinner({ size = 'md', className }) {
  const sizes = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-10 h-10' };
  return (
    <div className={clsx('border-2 border-dark-500 border-t-accent rounded-full animate-spin', sizes[size], className)} />
  );
}

export function PageSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <Spinner size="lg" />
    </div>
  );
}

export function EmptyState({ icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="text-4xl mb-3 text-gray-600">{icon}</div>}
      <h3 className="text-lg font-medium text-gray-400 mb-1">{title}</h3>
      {description && <p className="text-sm text-gray-500 mb-4 max-w-md">{description}</p>}
      {action}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={clsx('relative bg-dark-800 border border-dark-600 rounded-xl shadow-2xl p-6', wide ? 'w-full max-w-2xl' : 'w-full max-w-md')}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors text-xl leading-none">&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toast({ message, type = 'info', onClose }) {
  const colors = {
    info: 'border-accent/30 bg-accent/5 text-accent',
    success: 'border-neon-green/30 bg-neon-green/5 text-neon-green',
    error: 'border-neon-red/30 bg-neon-red/5 text-neon-red',
  };
  return (
    <div className={clsx('fixed top-4 right-4 z-[200] px-4 py-3 rounded-lg border text-sm animate-slide-in', colors[type])}>
      {message}
      {onClose && (
        <button onClick={onClose} className="ml-3 opacity-60 hover:opacity-100">&times;</button>
      )}
    </div>
  );
}
