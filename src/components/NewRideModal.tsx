import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { integration, useMutations } from 'deepspace'
import { MapPin, Search } from 'lucide-react'
import {
  Button,
  Input,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useToast,
} from './ui'
import { labelFor, weatherQueryFor, type GeoCandidate } from '../lib/geo'
import type { Pace, Ride } from '../lib/types'
import { PACE_LABEL } from '../lib/format'
import { cn } from '../lib/utils'

export function NewRideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const { ready, createConfirmed } = useMutations<Ride>('rides')
  const { error } = useToast()

  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [place, setPlace] = useState('')
  const [candidates, setCandidates] = useState<GeoCandidate[] | null>(null)
  const [picked, setPicked] = useState<GeoCandidate | null>(null)
  const [searching, setSearching] = useState(false)
  const [duration, setDuration] = useState('2')
  const [distance, setDistance] = useState('')
  const [pace, setPace] = useState<Pace>('steady')
  const [saving, setSaving] = useState(false)

  async function searchPlace() {
    const q = place.trim()
    if (!q || searching) return
    setSearching(true)
    setPicked(null)
    const r = await integration.post('openweathermap/geocoding', { q, limit: 5 })
    setSearching(false)
    if (!r.success) {
      error('Could not look up that place', r.error)
      return
    }
    const list = (Array.isArray(r.data) ? r.data : []) as GeoCandidate[]
    setCandidates(list)
    if (list.length === 1) setPicked(list[0])
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!picked || !title.trim()) return
    setSaving(true)
    try {
      const id = await createConfirmed({
        title: title.trim().slice(0, 80),
        notes: notes.trim().slice(0, 500),
        startArea: labelFor(picked),
        weatherQuery: weatherQueryFor(picked),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        durationHours: Math.min(Math.max(Number(duration) || 2, 0.5), 12),
        distanceMi: distance ? Math.min(Math.max(Number(distance), 1), 300) : undefined,
        pace,
      })
      onClose()
      navigate(`/rides/${id}`)
    } catch (err) {
      error('Could not create the ride', String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <Modal.Header>
        <Modal.Title>Plan a ride</Modal.Title>
        <Modal.Description>Next you’ll propose a few times for the group to vote on.</Modal.Description>
      </Modal.Header>
      <form onSubmit={submit} className="contents">
        <Modal.Body className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ride-title">Name</Label>
            <Input
              id="ride-title"
              placeholder="Saturday Grizzly Peak loop"
              value={title}
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ride-place">Start area</Label>
            <div className="flex gap-2">
              <Input
                id="ride-place"
                placeholder="City, e.g. Berkeley"
                value={place}
                onChange={(e) => {
                  setPlace(e.target.value)
                  setCandidates(null)
                  setPicked(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void searchPlace()
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={searchPlace} loading={searching}>
                {!searching && <Search aria-hidden />}
                Find
              </Button>
            </div>
            {candidates && candidates.length === 0 && (
              <p className="text-xs text-muted-foreground">No matches — try just the city name.</p>
            )}
            {candidates && candidates.length > 0 && (
              <div role="radiogroup" aria-label="Pick the start area" className="flex flex-wrap gap-1.5 pt-1">
                {candidates.map((c) => {
                  const active = picked === c
                  return (
                    <button
                      key={`${c.lat},${c.lon}`}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setPicked(c)}
                      className={cn(
                        'inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors duration-150',
                        active
                          ? 'border-primary bg-accent text-foreground'
                          : 'border-border text-muted-foreground hover:border-input hover:text-foreground',
                      )}
                    >
                      <MapPin aria-hidden className="size-3.5" />
                      {labelFor(c)}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ride-duration">Hours</Label>
              <Input
                id="ride-duration"
                type="number"
                min={0.5}
                max={12}
                step={0.5}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ride-distance">Miles</Label>
              <Input
                id="ride-distance"
                type="number"
                min={1}
                max={300}
                placeholder="40"
                value={distance}
                onChange={(e) => setDistance(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Pace</Label>
              <Select value={pace} onValueChange={(v) => setPace(v as Pace)}>
                <SelectTrigger aria-label="Pace">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PACE_LABEL) as Pace[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {PACE_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ride-notes">Notes</Label>
            <Textarea
              id="ride-notes"
              placeholder="Route link, regroup rules, who’s sweeping"
              value={notes}
              maxLength={500}
              rows={3}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready || !picked || !title.trim()} loading={saving}>
            Create ride
          </Button>
        </Modal.Footer>
      </form>
    </Modal>
  )
}
