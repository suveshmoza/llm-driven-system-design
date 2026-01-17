import { useSpreadsheetStore, getColumnLetter } from '../stores/spreadsheet';

export function Toolbar() {
  const title = useSpreadsheetStore((state) => state.title);
  const isConnected = useSpreadsheetStore((state) => state.isConnected);
  const activeCell = useSpreadsheetStore((state) => state.activeCell);
  const collaborators = useSpreadsheetStore((state) => state.collaborators);
  const getCell = useSpreadsheetStore((state) => state.getCell);

  const activeCellData = activeCell ? getCell(activeCell.row, activeCell.col) : null;
  const cellReference = activeCell
    ? `${getColumnLetter(activeCell.col)}${activeCell.row + 1}`
    : '';

  return (
    <div className="toolbar">
      {/* Title bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          borderBottom: '1px solid #e0e0e0',
          backgroundColor: 'white',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {/* Logo */}
          <div
            style={{
              width: 32,
              height: 32,
              backgroundColor: '#34a853',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontWeight: 'bold',
              fontSize: 18,
            }}
          >
            S
          </div>
          {/* Title */}
          <input
            type="text"
            value={title}
            readOnly
            style={{
              border: 'none',
              fontSize: '18px',
              fontWeight: 500,
              padding: '4px 8px',
              borderRadius: 4,
              outline: 'none',
            }}
          />
        </div>

        {/* Connection status and collaborators */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Collaborator avatars */}
          <div style={{ display: 'flex', gap: '-8px' }}>
            {Array.from(collaborators.values()).map((collab) => (
              <div
                key={collab.userId}
                title={collab.name}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  backgroundColor: collab.color,
                  border: '2px solid white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontSize: 12,
                  fontWeight: 'bold',
                  marginLeft: -8,
                }}
              >
                {collab.name.charAt(0).toUpperCase()}
              </div>
            ))}
          </div>

          {/* Connection indicator */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              color: isConnected ? '#34a853' : '#ea4335',
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: isConnected ? '#34a853' : '#ea4335',
              }}
            />
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
        </div>
      </div>

      {/* Formula bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '4px 16px',
          borderBottom: '1px solid #e0e0e0',
          backgroundColor: 'white',
          gap: 8,
        }}
      >
        {/* Cell reference */}
        <div
          style={{
            width: 60,
            padding: '4px 8px',
            backgroundColor: '#f1f3f4',
            borderRadius: 4,
            fontSize: 13,
            textAlign: 'center',
            fontWeight: 500,
          }}
        >
          {cellReference || '-'}
        </div>

        {/* Formula/value display */}
        <div
          style={{
            flex: 1,
            padding: '4px 8px',
            backgroundColor: '#f8f9fa',
            border: '1px solid #e0e0e0',
            borderRadius: 4,
            fontSize: 13,
            fontFamily: 'monospace',
            minHeight: 24,
          }}
        >
          {activeCellData?.rawValue || ''}
        </div>
      </div>
    </div>
  );
}
