import { Box } from 'lucide-react';

export function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <Box />
      <p>{text}</p>
    </div>
  );
}
