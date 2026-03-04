import { motion } from 'framer-motion';

export function LoadingSpinner() {
  console.log('[LoadingSpinner] Rendering loading spinner...');
  
  return (
    <div 
      className="fixed inset-0 bg-background flex items-center justify-center z-50"
      style={{ backgroundColor: '#0a0a1a', minHeight: '100vh' }}
    >
      <div className="text-center">
        <motion.div
          className="w-16 h-16 border-4 border-blue-500/30 border-t-blue-500 rounded-full mx-auto mb-4"
          style={{ borderTopColor: '#3b82f6', borderColor: 'rgba(59, 130, 246, 0.3)' }}
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        />
        <motion.h1 
          className="text-2xl font-bold mb-2 text-white"
          style={{ color: '#ffffff' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          Right Order
        </motion.h1>
        <motion.p 
          className="text-sm text-gray-400"
          style={{ color: '#9ca3af' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          Loading...
        </motion.p>
      </div>
    </div>
  );
}
