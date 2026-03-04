import { motion } from 'framer-motion';
import { useStore } from '@/store/useStore';

export function ConnectionOverlay() {
  const { connection } = useStore();

  if (connection.isConnected && !connection.isReconnecting) {
    return null;
  }

  return (
    <motion.div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="text-center p-8 rounded-lg bg-card border border-border">
        <motion.div
          className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full mx-auto mb-4"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        />
        <h2 className="text-xl font-bold mb-2 text-white">
          {connection.isReconnecting ? 'Reconnecting...' : 'Connecting...'}
        </h2>
        <p className="text-sm text-gray-400">
          {connection.reconnectAttempts > 0 
            ? `Attempt ${connection.reconnectAttempts} of 10`
            : 'Establishing connection to server'}
        </p>
        {connection.lastError && typeof connection.lastError === 'string' && (
          <p className="text-xs text-red-400 mt-2">{connection.lastError}</p>
        )}
      </div>
    </motion.div>
  );
}
