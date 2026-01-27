import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

function App() {
  const [players, setPlayers] = useState([])
  const [picks, setPicks] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchText, setSearchText] = useState("")

  useEffect(() => {
    fetchInitialData()

    // Listen for UPDATES to the draft-order table
    const channel = supabase
      .channel('draft_updates')
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'draft-order' 
      }, (payload) => {
        // Update the local state when someone makes a pick
        setPicks((currentPicks) => 
          currentPicks.map(p => 
            p['Overall Pick'] === payload.new['Overall Pick'] ? payload.new : p
          )
        )
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  async function fetchInitialData() {
    setLoading(true)
    
    console.log('Starting to fetch data from Supabase...')
    
    // Fetch all players from the player-pool table
    const { data: pData, error: pError } = await supabase
      .from('player-pool')
      .select('*')
    
    console.log('Player pool response:', { 
      dataCount: pData?.length, 
      error: pError,
      sampleRow: pData?.[0] // Show us the first row to verify column names
    })
    
    // Fetch the entire draft schedule from draft-order table
    const { data: dData, error: dError } = await supabase
      .from('draft-order')
      .select('*')
      .order('Overall Pick', { ascending: true })

    console.log('Draft order response:', { 
      dataCount: dData?.length, 
      error: dError,
      sampleRow: dData?.[0] // Show us the first row to verify column names
    })
    
    if (pError) console.error("Error loading players:", pError)
    if (dError) console.error("Error loading draft:", dError)
    
    if (pData) setPlayers(pData)
    if (dData) setPicks(dData)
    
    setLoading(false)
  }

  // Find the first pick without an ESPN PlayerID assigned
  const currentPick = picks.find(p => !p['ESPN PlayerID'] || p['ESPN PlayerID'] === '')
  
  // Check if a player has already been drafted
  const isTaken = (espnPlayerId) => {
    const player = players.find(p => p['ESPN PlayerID'] === espnPlayerId)
    return player && player.Availability !== 'Available'
  }

  // Draft a player by updating the draft-order table
  const handleDraft = async (espnPlayerId) => {
    if (!currentPick) {
      return alert("Draft is complete!")
    }

    const player = players.find(p => p['ESPN PlayerID'] === espnPlayerId)
    const confirmMsg = `Draft ${player?.Player} for ${currentPick.Owner}?`
    
    if (!window.confirm(confirmMsg)) return

    // Update the draft-order table with the selected player
    const { error } = await supabase
      .from('draft-order')
      .update({ 
        'ESPN PlayerID': espnPlayerId,
        'Selection': player.Player
      })
      .eq('Overall Pick', currentPick['Overall Pick'])

    if (error) {
      alert(error.message)
    } else {
      // Update the player-pool table to mark player as unavailable
      await supabase
        .from('player-pool')
        .update({ 'Availability': currentPick.Owner })
        .eq('ESPN PlayerID', espnPlayerId)
    }
  }

  if (loading) {
    return <div className="p-10 text-xl">Loading Draft Room...</div>
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'Arial, sans-serif' }}>
      
      {/* LEFT PANEL: Available Players */}
      <div style={{ width: '40%', borderRight: '1px solid #ddd', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px', background: '#f0f0f0', borderBottom: '1px solid #ccc' }}>
          <h2>Available Players</h2>
          {currentPick && (
            <div style={{ 
              padding: '10px', 
              background: '#d4edda', 
              color: '#155724', 
              borderRadius: '4px', 
              marginBottom: '10px' 
            }}>
              <strong>ON THE CLOCK:</strong> {currentPick.Owner} (Round {currentPick.Round}, Pick {currentPick.Pick})
            </div>
          )}
          <input 
            type="text" 
            placeholder="Search players..." 
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '0 20px' }}>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {players
              .filter(p => p.Availability === 'Available')
              .filter(p => p.Player && p.Player.toLowerCase().includes(searchText.toLowerCase()))
              .slice(0, 100)
              .map(player => (
                <li 
                  key={player['ESPN PlayerID']} 
                  style={{ 
                    borderBottom: '1px solid #eee', 
                    padding: '10px 0', 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center' 
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 'bold' }}>{player.Player}</div>
                    <div style={{ fontSize: '0.85em', color: '#666' }}>
                      {player.Position} - {player.Team} (ADP: {player.ADP || 'N/A'})
                    </div>
                  </div>
                  <button 
                    disabled={!currentPick}
                    onClick={() => handleDraft(player['ESPN PlayerID'])}
                    style={{ 
                      background: currentPick ? '#007bff' : '#ccc', 
                      color: 'white', 
                      border: 'none', 
                      padding: '6px 12px', 
                      borderRadius: '4px', 
                      cursor: currentPick ? 'pointer' : 'not-allowed' 
                    }}
                  >
                    Draft
                  </button>
                </li>
              ))}
          </ul>
        </div>
      </div>

      {/* RIGHT PANEL: Draft Board */}
      <div style={{ width: '60%', overflowY: 'auto', padding: '20px', background: '#fafafa' }}>
        <h2>Draft Board</h2>
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', 
          gap: '10px' 
        }}>
          {picks.map((pick) => {
            const selectedPlayer = pick['ESPN PlayerID'] 
              ? players.find(p => p['ESPN PlayerID'] === pick['ESPN PlayerID'])
              : null
            
            const isFilled = Boolean(selectedPlayer)
            const isCurrent = currentPick && currentPick['Overall Pick'] === pick['Overall Pick']
            
            let cardStyle = { 
              border: '1px solid #ddd', 
              padding: '10px', 
              borderRadius: '4px', 
              background: 'white', 
              fontSize: '0.9em' 
            }
            
            if (isCurrent) {
              cardStyle = { 
                ...cardStyle, 
                border: '2px solid #28a745', 
                background: '#e9f7ef' 
              }
            } else if (isFilled) {
              cardStyle = { 
                ...cardStyle, 
                background: '#e2e6ea', 
                color: '#555' 
              }
            }

            return (
              <div key={pick['Overall Pick']} style={cardStyle}>
                <div style={{ fontWeight: 'bold', color: '#888', marginBottom: '4px' }}>
                  {pick['Overall Pick']}. {pick.Owner}
                  {isCurrent && <span style={{ color: 'red', marginLeft: '5px' }}>●</span>}
                </div>
                {isFilled ? (
                  <div style={{ fontWeight: 'bold', color: '#000' }}>
                    {selectedPlayer?.Player || pick.Selection}
                  </div>
                ) : (
                  <div style={{ color: '#ccc', fontStyle: 'italic' }}>Empty</div>
                )}
                <div style={{ fontSize: '0.8em', color: '#aaa', marginTop: '4px' }}>
                  Rd {pick.Round} - Pick {pick.Pick}
                </div>
              </div>
            )
          })}
        </div>
      </div>

    </div>
  )
}

export default App