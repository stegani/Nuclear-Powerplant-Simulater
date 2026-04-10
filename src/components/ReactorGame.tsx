import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Zap, 
  Thermometer, 
  Wind, 
  Activity, 
  AlertTriangle, 
  Settings, 
  Play, 
  Pause, 
  RotateCcw,
  Gauge,
  Droplets,
  Cpu,
  TrendingUp,
  ShieldAlert,
  HelpCircle
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from '@/lib/utils';

// Constants
const MAX_TEMP = 1200; // Celsius
const MELTDOWN_TEMP = 1000;
const CRITICAL_TEMP = 850;
const OPTIMAL_TEMP_MIN = 600;
const OPTIMAL_TEMP_MAX = 800;
const TICK_RATE = 500; // ms

interface HistoryData {
  time: number;
  temp: number;
  power: number;
  pressure: number;
}

export default function ReactorGame() {
  // Simulation State
  const [isRunning, setIsRunning] = useState(false);
  const [time, setTime] = useState(0);
  const [coreTemp, setCoreTemp] = useState(300); // Start at 300C
  const [neutronFlux, setNeutronFlux] = useState(0);
  const [steamPressure, setSteamPressure] = useState(0);
  const [powerOutput, setPowerOutput] = useState(0);
  const [potentialPower, setPotentialPower] = useState(0);
  const [isTurbineLocked, setIsTurbineLocked] = useState(false);
  const [efficiency, setEfficiency] = useState(0);
  const [history, setHistory] = useState<HistoryData[]>([]);
  const [isMeltdown, setIsMeltdown] = useState(false);
  const [showGameOver, setShowGameOver] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [score, setScore] = useState(0);
  const [sessionTime, setSessionTime] = useState(0);
  const [fuel, setFuel] = useState(100); // 100% fuel
  const [vesselIntegrity, setVesselIntegrity] = useState(100); // 100% integrity

  // Control State
  const [controlRods, setControlRods] = useState(100); // 100% inserted = 0 reactivity
  const [coolantFlow, setCoolantFlow] = useState(20); // 20% flow
  const [secondaryCoolant, setSecondaryCoolant] = useState(20); // 20% flow
  const [gridLoad, setGridLoad] = useState(50); // 50% load

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Alert Sound Effect
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRunning && coreTemp >= 950) {
      interval = setInterval(() => {
        try {
          if (!audioContextRef.current) {
            const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
            if (AudioContextClass) {
              audioContextRef.current = new AudioContextClass();
            }
          }
          
          if (audioContextRef.current) {
            const ctx = audioContextRef.current;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            
            osc.type = 'square';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
            
            gain.gain.setValueAtTime(0.05, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
            
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            osc.start();
            osc.stop(ctx.currentTime + 0.15);
          }
        } catch (e) {
          console.error("Audio error:", e);
        }
      }, 400);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRunning, coreTemp >= 950]);

  const resetGame = useCallback(() => {
    setCoreTemp(300);
    setNeutronFlux(0);
    setSteamPressure(0);
    setPowerOutput(0);
    setPotentialPower(0);
    setIsTurbineLocked(false);
    setEfficiency(0);
    setHistory([]);
    setIsMeltdown(false);
    setShowGameOver(false);
    setTime(0);
    setScore(0);
    setSessionTime(0);
    setFuel(100);
    setVesselIntegrity(100);
    setControlRods(100);
    setCoolantFlow(20);
    setSecondaryCoolant(20);
    setGridLoad(50);
    setIsRunning(false);
  }, []);

  const scram = useCallback(() => {
    setControlRods(100);
    setIsTurbineLocked(false);
    // Add a log entry for SCRAM
    setHistory(prev => {
      const newData = [...prev, { 
        time: time, 
        temp: Math.round(coreTemp), 
        power: Math.round(powerOutput),
        pressure: Math.round(steamPressure)
      }];
      return newData.slice(-30);
    });
  }, [time, coreTemp, powerOutput, steamPressure]);

  const updateSimulation = useCallback(() => {
    if (isMeltdown) return;

    // Ensure inputs are valid numbers
    const rods = Number(controlRods) || 0;
    const flow = Number(coolantFlow) || 0;
    const secFlow = Number(secondaryCoolant) || 0;
    const load = Number(gridLoad) || 0;

    // 1. Reactivity & Neutron Flux
    // Rods at 0% (fully out) = high reactivity. Rods at 100% (fully in) = zero reactivity.
    const reactivity = Math.max(0, (100 - rods) / 100);
    const targetFlux = reactivity * 1000;
    const newFlux = neutronFlux + (targetFlux - neutronFlux) * 0.1;

    // 2. Core Temperature
    // Heat generated by flux, removed by primary coolant
    const heatGen = newFlux * 0.5;
    const heatRemoval = (flow / 100) * (coreTemp - 25) * 0.15;
    const ambientLoss = (coreTemp - 25) * 0.01;
    const newTemp = coreTemp + heatGen - heatRemoval - ambientLoss;

    // 3. Steam Pressure & Secondary Cooling
    // Primary heat transfers to secondary loop to create steam
    // Secondary coolant flow regulates how much heat is extracted from the steam generators
    const heatToSteam = (flow / 100) * (newTemp - 100) * 0.8;
    const steamCooling = (secFlow / 100) * steamPressure * 0.2;
    const targetPressure = Math.max(0, heatToSteam * 1.5 - steamCooling);
    const newPressure = steamPressure + (targetPressure - steamPressure) * 0.05;

    // 4. Vessel Integrity
    // Degrades if temp > 850C
    let integrityLoss = 0;
    if (newTemp > 850) {
      integrityLoss = (newTemp - 850) * 0.005;
    }
    const newIntegrity = Math.max(0, vesselIntegrity - integrityLoss);

    // 5. Power Output
    // Steam pressure drives turbine. Efficiency depends on matching requested load.
    // Performance scales with vessel integrity
    const maxGridCapacity = 1000; // 1000 MW max demand
    const requestedPower = (load / 100) * maxGridCapacity;
    const turbinePotential = newPressure * 1.5 * (vesselIntegrity / 100);
    
    // Actual power delivered is what we can produce, capped by what the grid can take
    // ONLY if the turbine is locked to the grid
    const actualPower = isTurbineLocked ? Math.min(turbinePotential || 0, requestedPower) : 0;
    
    // Efficiency: 100% when production matches demand. 
    // We use a percentage-based difference for a smoother curve
    // Efficiency is also limited by remaining fuel
    const powerDiff = Math.abs(turbinePotential - requestedPower);
    const maxVal = Math.max(turbinePotential, requestedPower, 1);
    const baseEfficiency = Math.max(0, 100 - (powerDiff / maxVal) * 100);
    const newEfficiency = isTurbineLocked ? baseEfficiency * (fuel / 100) : 0;

    // 6. Update State with safety checks
    if (!isNaN(newFlux) && !isNaN(newTemp) && !isNaN(newPressure) && !isNaN(actualPower)) {
      setNeutronFlux(newFlux);
      setCoreTemp(newTemp);
      setSteamPressure(newPressure);
      setPowerOutput(actualPower);
      setPotentialPower(turbinePotential);
      setEfficiency(newEfficiency);
      setVesselIntegrity(newIntegrity);
      setSessionTime(prev => prev + 0.5);

      // Turbine Trip Logic: If pressure drops too low while locked, it trips
      if (isTurbineLocked && newPressure < 150) {
        setIsTurbineLocked(false);
      }
      
      // Fuel consumption: targeted to last 10 minutes (600s) at full power (1000 flux)
      // 600s / 0.5s (TICK_RATE) = 1200 ticks. 100% / 1200 = 0.0833 per tick at max flux.
      const fuelConsumption = (newFlux / 1000) * 0.0833;
      const newFuel = Math.max(0, fuel - fuelConsumption);
      setFuel(newFuel);

      // Score: Accumulate energy generated (GWh equivalent)
      // actualPower is in MW, TICK_RATE is 0.5s. 
      // Energy = Power * Time. 0.5s is 1/7200 of an hour.
      // MW -> MWh: / 7200. MWh -> GWh: / 1000. Total divisor: 7,200,000
      const energyGenerated = (actualPower / 7200000); 
      setScore(prev => prev + energyGenerated);

      // 7. Meltdown Check
      if (newTemp >= MELTDOWN_TEMP) {
        setIsMeltdown(true);
        setIsRunning(false);
        setShowGameOver(true);
      }

      // 8. Fuel Depletion Check
      if (newFuel <= 0) {
        setIsRunning(false);
        setShowGameOver(true);
      }

      // 9. Vessel Breach Check
      if (newIntegrity <= 0) {
        setIsMeltdown(true);
        setIsRunning(false);
        setShowGameOver(true);
      }

      // 10. History
      setHistory(prev => {
        const newData = [...prev, { 
          time: time, 
          temp: Math.round(newTemp), 
          power: Math.round(turbinePotential),
          pressure: Math.round(newPressure)
        }];
        return newData.slice(-30); // Keep last 30 ticks
      });

      setTime(prev => prev + 1);
    }
  }, [controlRods, coolantFlow, secondaryCoolant, coreTemp, gridLoad, isMeltdown, neutronFlux, steamPressure, time, isTurbineLocked, fuel, vesselIntegrity]);

  useEffect(() => {
    if (isRunning && !isMeltdown) {
      timerRef.current = setInterval(updateSimulation, TICK_RATE);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRunning, isMeltdown, updateSimulation]);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatPower = (mw: number) => {
    if (mw >= 1000) {
      return `${(mw / 1000).toFixed(2)} GW`;
    }
    return `${Math.round(mw)} MW`;
  };

  const getStatusColor = () => {
    if (coreTemp > CRITICAL_TEMP) return 'text-red-500';
    if (coreTemp > OPTIMAL_TEMP_MAX || coreTemp < OPTIMAL_TEMP_MIN) return 'text-yellow-500';
    return 'text-green-500';
  };

  const getStatusBadge = () => {
    if (isMeltdown) return <Badge variant="destructive" className="font-bold">MELTDOWN</Badge>;
    if (fuel <= 0) return <Badge variant="outline" className="text-zinc-400 border-zinc-700 font-bold">FUEL DEPLETED</Badge>;
    if (coreTemp > CRITICAL_TEMP) return <Badge variant="destructive" className="animate-pulse font-bold">CRITICAL</Badge>;
    if (coreTemp > OPTIMAL_TEMP_MAX) return <Badge variant="secondary" className="bg-yellow-500 text-black font-bold">OVERHEATING</Badge>;
    if (coreTemp < OPTIMAL_TEMP_MIN && neutronFlux > 0) return <Badge variant="secondary" className="bg-blue-500 text-white font-bold">UNDERHEATED</Badge>;
    if (neutronFlux === 0) return <Badge variant="outline" className="text-zinc-400 border-zinc-700 font-bold">STANDBY</Badge>;
    return <Badge variant="secondary" className="bg-emerald-500 text-white font-bold">OPTIMAL</Badge>;
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 p-4 md:p-8 font-mono">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-zinc-800 pb-6 relative">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tighter flex items-center gap-2">
                <Cpu className="w-8 h-8 text-emerald-500" />
                NUCLEUS <span className="text-zinc-500 font-light">v1.0.5</span>
              </h1>
              <p className="text-zinc-400 text-sm">Reactor Control Interface - Sector 7-G</p>
            </div>

            <AnimatePresence>
              {(coreTemp >= 950 || isMeltdown) && (
                <motion.div 
                  initial={{ opacity: 0, x: -20, scale: 0.9 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: 20, scale: 0.9 }}
                  className="flex items-center gap-3 px-4 py-2 bg-red-600 text-white font-black italic tracking-tighter animate-pulse rounded-sm shadow-[0_0_20px_rgba(220,38,38,0.4)]"
                >
                  <AlertTriangle className="w-5 h-5" />
                  <span className="text-sm md:text-base">MELTDOWN IMMINENT</span>
                  <AlertTriangle className="w-5 h-5" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="text-right border-r border-zinc-800 pr-4">
              <div className="text-[10px] text-zinc-500 uppercase tracking-widest">Session Time</div>
              <div className="text-xl font-bold text-zinc-300 tabular-nums">{formatTime(sessionTime)}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-zinc-400 uppercase tracking-widest">Total Energy Generated</div>
              <div className="flex flex-col items-end">
                <div className="text-2xl font-bold text-emerald-400">{(score || 0).toFixed(4)} <span className="text-xs">GWh</span></div>
                <div className="text-[10px] text-zinc-500 font-medium">≈ {((score || 0) * 1000).toFixed(2)} MWh</div>
              </div>
            </div>
            <div className="h-10 w-[1px] bg-zinc-800 mx-2" />
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="icon"
                onClick={() => setShowHelp(true)}
                className="border-zinc-700 text-zinc-400 hover:text-zinc-100"
                title="Help & Manual"
              >
                <HelpCircle className="w-4 h-4" />
              </Button>
              <Button 
                variant={isRunning ? "outline" : "default"}
                onClick={() => setIsRunning(!isRunning)}
                disabled={isMeltdown}
                className={cn(
                  "w-32 transition-all font-bold",
                  isRunning 
                    ? "border-zinc-400 text-zinc-50 hover:bg-zinc-800 bg-zinc-900" 
                    : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                )}
              >
                {isRunning ? <><Pause className="w-4 h-4 mr-2" /> PAUSE</> : <><Play className="w-4 h-4 mr-2" /> START</>}
              </Button>
              <Button 
                variant="outline" 
                size="icon" 
                onClick={resetGame} 
                className="border-zinc-400 text-zinc-50 hover:bg-zinc-800 bg-zinc-900"
                title="Reset Reactor"
              >
                <RotateCcw className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left Panel: Controls */}
          <aside className="lg:col-span-3 space-y-6">
            <Card className="bg-zinc-900/50 border-zinc-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase tracking-widest text-zinc-400 flex items-center gap-2">
                  <Settings className="w-3 h-3" /> Control Systems
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-8 pt-4">
                
                <div className="space-y-4">
                  <div className="flex justify-between items-end">
                    <label className="text-sm font-medium flex items-center gap-2 text-zinc-100">
                      <Activity className="w-4 h-4 text-emerald-500" /> Control Rods
                    </label>
                    <span className="text-xs font-bold text-zinc-300">{Math.min(100, Math.max(0, Math.round(controlRods || 0)))}% <span className="font-normal opacity-50">IN</span></span>
                  </div>
                  <Slider 
                    value={[controlRods]} 
                    onValueChange={(v) => {
                      const val = Array.isArray(v) ? v[0] : v;
                      if (typeof val === 'number') setControlRods(val);
                    }} 
                    min={0}
                    max={100} 
                    step={1}
                    className="[&_[data-slot=slider-range]]:bg-emerald-500 [&_[data-slot=slider-thumb]]:bg-emerald-500 [&_[data-slot=slider-track]]:bg-zinc-800"
                  />
                  <p className="text-[10px] text-zinc-400 leading-tight">
                    Lower values increase reactivity and heat. High values dampen the reaction.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-end">
                    <label className="text-sm font-medium flex items-center gap-2 text-zinc-100">
                      <Wind className="w-4 h-4 text-blue-500" /> Primary Coolant
                    </label>
                    <span className="text-xs font-bold text-zinc-300">{Math.min(100, Math.max(0, Math.round(coolantFlow || 0)))}%</span>
                  </div>
                  <Slider 
                    value={[coolantFlow]} 
                    onValueChange={(v) => {
                      const val = Array.isArray(v) ? v[0] : v;
                      if (typeof val === 'number') setCoolantFlow(val);
                    }} 
                    min={0}
                    max={100} 
                    step={1}
                    className="[&_[data-slot=slider-range]]:bg-blue-500 [&_[data-slot=slider-thumb]]:bg-blue-500 [&_[data-slot=slider-track]]:bg-zinc-800"
                  />
                  <p className="text-[10px] text-zinc-400 leading-tight">
                    Removes heat from the reactor core.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-end">
                    <label className="text-sm font-medium flex items-center gap-2 text-zinc-100">
                      <Droplets className="w-4 h-4 text-cyan-400" /> Secondary Loop
                    </label>
                    <span className="text-xs font-bold text-zinc-300">{Math.min(100, Math.max(0, Math.round(secondaryCoolant || 0)))}%</span>
                  </div>
                  <Slider 
                    value={[secondaryCoolant]} 
                    onValueChange={(v) => {
                      const val = Array.isArray(v) ? v[0] : v;
                      if (typeof val === 'number') setSecondaryCoolant(val);
                    }} 
                    min={0}
                    max={100} 
                    step={1}
                    className="[&_[data-slot=slider-range]]:bg-cyan-400 [&_[data-slot=slider-thumb]]:bg-cyan-400 [&_[data-slot=slider-track]]:bg-zinc-800"
                  />
                  <p className="text-[10px] text-zinc-400 leading-tight">
                    Regulates steam generation and pressure.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-end">
                    <label className="text-sm font-medium flex items-center gap-2 text-zinc-100">
                      <Zap className="w-4 h-4 text-yellow-500" /> Grid Demand
                    </label>
                    <span className="text-xs font-bold text-zinc-300">{formatPower((gridLoad / 100) * 1000)}</span>
                  </div>
                  <Slider 
                    value={[gridLoad]} 
                    onValueChange={(v) => {
                      const val = Array.isArray(v) ? v[0] : v;
                      if (typeof val === 'number') setGridLoad(val);
                    }} 
                    min={0}
                    max={100} 
                    step={1}
                    className="[&_[data-slot=slider-range]]:bg-yellow-500 [&_[data-slot=slider-thumb]]:bg-yellow-500 [&_[data-slot=slider-track]]:bg-zinc-800"
                  />
                  <p className="text-[10px] text-zinc-400 leading-tight">
                    Requested power from the grid. Adjust reactor output to match this target for maximum efficiency.
                  </p>
                </div>

                <div className="pt-4">
                  <Button 
                    variant="destructive" 
                    className="w-full bg-red-900/50 hover:bg-red-600 border border-red-500 text-red-100 font-black tracking-[0.2em] h-12 shadow-[0_0_20px_rgba(239,68,68,0.1)] hover:shadow-[0_0_25px_rgba(239,68,68,0.3)] transition-all"
                    onClick={scram}
                    disabled={!isRunning || isMeltdown}
                  >
                    <ShieldAlert className="w-5 h-5 mr-2" /> SCRAM
                  </Button>
                  <p className="text-[9px] text-red-500/50 mt-2 text-center uppercase font-bold tracking-tighter">
                    Emergency Shutdown: Immediate Rod Insertion
                  </p>
                </div>

              </CardContent>
            </Card>

            <Card className="bg-zinc-900/50 border-zinc-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase tracking-widest text-zinc-400">System Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-2">
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-zinc-300">Nuclear Fuel</span>
                    <span className={cn("text-xs font-bold", fuel < 20 ? "text-red-500 animate-pulse" : "text-emerald-500")}>
                      {Math.round(fuel)}%
                    </span>
                  </div>
                  <Progress 
                    value={fuel} 
                    className={cn(
                      "h-1 [&_[data-slot=progress-track]]:bg-zinc-950 [&_[data-slot=progress-track]]:border [&_[data-slot=progress-track]]:border-zinc-800/50", 
                      fuel < 20 ? "[&_[data-slot=progress-indicator]]:bg-red-500" : "[&_[data-slot=progress-indicator]]:bg-emerald-400"
                    )} 
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-zinc-300">Core Health</span>
                    <span className={cn("text-xs font-bold", coreTemp > CRITICAL_TEMP ? "text-red-500" : "text-emerald-500")}>
                      {coreTemp > CRITICAL_TEMP ? "CRITICAL" : "STABLE"}
                    </span>
                  </div>
                  <Progress 
                    value={Math.max(0, 100 - (coreTemp / MAX_TEMP) * 100)} 
                    className={cn(
                      "h-1 [&_[data-slot=progress-track]]:bg-zinc-950 [&_[data-slot=progress-track]]:border [&_[data-slot=progress-track]]:border-zinc-800/50",
                      coreTemp > CRITICAL_TEMP ? "[&_[data-slot=progress-indicator]]:bg-red-500" : "[&_[data-slot=progress-indicator]]:bg-emerald-400"
                    )} 
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-zinc-300">Vessel Integrity</span>
                    <span className={cn("text-xs font-bold", vesselIntegrity < 50 ? "text-red-500" : "text-emerald-500")}>
                      {Math.round(vesselIntegrity)}%
                    </span>
                  </div>
                  <Progress 
                    value={vesselIntegrity} 
                    className={cn(
                      "h-1 [&_[data-slot=progress-track]]:bg-zinc-950 [&_[data-slot=progress-track]]:border [&_[data-slot=progress-track]]:border-zinc-800/50", 
                      vesselIntegrity < 50 ? "[&_[data-slot=progress-indicator]]:bg-red-500" : "[&_[data-slot=progress-indicator]]:bg-emerald-400"
                    )} 
                  />
                </div>
                
                <div className="flex justify-between items-center">
                  <span className="text-xs text-zinc-300">Turbine Sync</span>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-[10px] font-bold px-1.5 py-0.5 rounded-sm",
                      isTurbineLocked ? "bg-blue-500/20 text-blue-400" : "bg-zinc-800 text-zinc-500"
                    )}>
                      {isTurbineLocked ? "LOCKED" : "UNLOCKED"}
                    </span>
                    <Button 
                      size="sm" 
                      variant="outline" 
                      className={cn(
                        "h-6 text-[9px] px-2 font-bold transition-all",
                        isTurbineLocked 
                          ? "border-red-900/50 text-red-400 hover:bg-red-900/20" 
                          : "border-blue-900/50 text-blue-400 hover:bg-blue-900/20"
                      )}
                      disabled={!isRunning || isMeltdown || (!isTurbineLocked && steamPressure < 200)}
                      onClick={() => setIsTurbineLocked(!isTurbineLocked)}
                    >
                      {isTurbineLocked ? "DISCONNECT" : "SYNC TO GRID"}
                    </Button>
                  </div>
                </div>
                {!isTurbineLocked && isRunning && steamPressure < 200 && (
                  <p className="text-[8px] text-blue-500/70 italic">
                    * Pressure too low for synchronization (min 200 PSI)
                  </p>
                )}
                
                <div className="pt-2">
                  {getStatusBadge()}
                </div>
              </CardContent>
            </Card>
          </aside>

          {/* Center Panel: Visualization & Gauges */}
          <main className="lg:col-span-6 space-y-6">
            
            {/* Reactor Visualization */}
            <Card className="bg-zinc-950 border-zinc-800 overflow-hidden relative min-h-[300px] flex items-center justify-center">
              <div className="absolute inset-0 opacity-20 pointer-events-none" 
                   style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, #333 1px, transparent 0)', backgroundSize: '24px 24px' }} />
              
              <div className="relative z-10 flex items-center gap-12">
                {/* Primary Loop (Reactor Vessel) */}
                <div className="flex flex-col items-center">
                  <div className="w-48 h-64 border-2 border-zinc-700 rounded-t-full rounded-b-3xl relative flex items-end justify-center overflow-hidden bg-zinc-900 shadow-[0_0_30px_rgba(0,0,0,0.5)]">
                    {/* Water/Coolant Level */}
                    <motion.div 
                      className="absolute bottom-0 w-full bg-blue-500/30"
                      animate={{ height: `${coolantFlow}%` }}
                      transition={{ type: 'spring', stiffness: 50 }}
                    />
                    
                    {/* Reactor Core Glow */}
                    <motion.div 
                      className="w-24 h-40 rounded-lg absolute bottom-12 flex flex-col justify-around p-2"
                      animate={{ 
                        backgroundColor: coreTemp > CRITICAL_TEMP ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.1)',
                        boxShadow: [
                          `0 0 ${neutronFlux / 15}px rgba(52, 211, 153, 0.3)`,
                          `0 0 ${neutronFlux / 6}px rgba(52, 211, 153, 0.6)`,
                          `0 0 ${neutronFlux / 15}px rgba(52, 211, 153, 0.3)`
                        ]
                      }}
                      transition={{
                        boxShadow: {
                          duration: Math.max(0.4, 2 - (neutronFlux / 500)),
                          repeat: Infinity,
                          ease: "easeInOut"
                        },
                        backgroundColor: { duration: 0.5 }
                      }}
                    >
                      {/* Fuel Rods */}
                      {[1, 2, 3, 4].map(i => (
                        <div key={i} className="h-2 w-full bg-zinc-800 rounded-full relative overflow-hidden">
                          <motion.div 
                            className="absolute inset-0 bg-emerald-500"
                            animate={{ opacity: neutronFlux / 1000 }}
                          />
                        </div>
                      ))}
                    </motion.div>

                    {/* Control Rods (Visual) */}
                    <motion.div 
                      className="absolute top-0 w-24 flex justify-around px-2"
                      animate={{ y: `${controlRods * 0.4}%` }}
                    >
                      {[1, 2, 3, 4].map(i => (
                        <div key={i} className="w-2 h-32 bg-zinc-600 rounded-b-full shadow-lg" />
                      ))}
                    </motion.div>
                  </div>
                  
                  <div className="mt-4 flex flex-col items-center gap-1">
                    <div className="text-[10px] text-zinc-300 uppercase tracking-[0.2em] font-bold">Primary Containment</div>
                    <div className="w-40 h-1.5 bg-zinc-950 border border-zinc-800/50 rounded-full overflow-hidden">
                      <motion.div 
                        className={cn("h-full", vesselIntegrity < 50 ? "bg-red-500" : "bg-emerald-400")}
                        animate={{ width: `${vesselIntegrity}%` }}
                      />
                    </div>
                    <div className="text-[8px] text-zinc-500 font-bold">{Math.round(vesselIntegrity)}% INTEGRITY</div>
                  </div>
                </div>

                {/* Heat Exchanger & Secondary Loop */}
                <div className="flex flex-col items-center">
                  <div className="w-32 h-48 border-2 border-zinc-800 rounded-xl relative flex items-center justify-center bg-zinc-900/50 overflow-hidden">
                    {/* Steam Visualization */}
                    <motion.div 
                      className="absolute inset-0 bg-cyan-500/10"
                      animate={{ 
                        opacity: [0.1, 0.3, 0.1],
                        backgroundColor: steamPressure > 400 ? 'rgba(6, 182, 212, 0.3)' : 'rgba(6, 182, 212, 0.1)'
                      }}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                    
                    {/* Secondary Flow Particles */}
                    <div className="absolute inset-0 overflow-hidden">
                      {[...Array(5)].map((_, i) => (
                        <motion.div
                          key={i}
                          className="absolute w-1 h-1 bg-cyan-400 rounded-full"
                          initial={{ x: -10, y: 20 + i * 20 }}
                          animate={{ 
                            x: 140,
                            opacity: [0, 1, 0]
                          }}
                          transition={{ 
                            duration: Math.max(0.5, 3 - (secondaryCoolant / 30)), 
                            repeat: Infinity, 
                            delay: i * 0.4 
                          }}
                        />
                      ))}
                    </div>

                    <div className="z-10 text-center">
                      <Droplets className={cn("w-8 h-8 mx-auto mb-1", steamPressure > 0 ? "text-cyan-400" : "text-zinc-700")} />
                      <div className="text-[10px] font-bold text-zinc-500 uppercase">Steam Gen</div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-col items-center gap-1">
                    <div className="text-[10px] text-zinc-300 uppercase tracking-[0.2em] font-bold">Secondary Loop</div>
                    <div className="w-32 h-1.5 bg-zinc-950 border border-zinc-800/50 rounded-full overflow-hidden">
                      <motion.div 
                        className="h-full bg-cyan-400"
                        animate={{ width: `${secondaryCoolant}%` }}
                      />
                    </div>
                    <div className="text-[8px] text-zinc-500 font-bold">FLOW: {Math.round(secondaryCoolant)}%</div>
                  </div>
                </div>

                {/* Connecting Pipes (Visual) */}
                <div className="absolute left-48 top-1/2 -translate-y-1/2 w-12 h-16 pointer-events-none">
                  <div className="absolute top-2 w-full h-2 bg-zinc-800 border-y border-zinc-700" />
                  <div className="absolute bottom-2 w-full h-2 bg-zinc-800 border-y border-zinc-700" />
                </div>
              </div>

              {/* Warning Overlays */}
              <AnimatePresence>
                {coreTemp > CRITICAL_TEMP && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 0.3, 0] }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 1, repeat: Infinity }}
                    className="absolute inset-0 bg-red-600 pointer-events-none"
                  />
                )}
              </AnimatePresence>
            </Card>

            {/* Gauges Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="bg-zinc-900/50 border-zinc-800">
                <CardContent className="pt-6 flex flex-col items-center text-center">
                  <Thermometer className={cn("w-6 h-6 mb-2", getStatusColor())} />
                  <div className="text-2xl font-bold tabular-nums text-zinc-50">{Math.round(coreTemp || 0)}°C</div>
                  <div className="text-[10px] text-zinc-400 uppercase tracking-widest font-semibold">Core Temperature</div>
                </CardContent>
              </Card>

              <Card className="bg-zinc-900/50 border-zinc-800">
                <CardContent className="pt-6 flex flex-col items-center text-center">
                  <Wind className="w-6 h-6 mb-2 text-blue-400" />
                  <div className="text-2xl font-bold tabular-nums text-zinc-50">{Math.round(steamPressure || 0)} <span className="text-xs font-normal opacity-70">PSI</span></div>
                  <div className="text-[10px] text-zinc-400 uppercase tracking-widest font-semibold">Steam Pressure</div>
                </CardContent>
              </Card>

              <Card className="bg-zinc-900/50 border-zinc-800">
                <CardContent className="pt-6 flex flex-col items-center text-center">
                  <Gauge className="w-6 h-6 mb-2 text-emerald-400" />
                  <div className="text-2xl font-bold tabular-nums text-zinc-50">{Math.round(neutronFlux || 0)} <span className="text-xs font-normal opacity-70">n/cm²s</span></div>
                  <div className="text-[10px] text-zinc-400 uppercase tracking-widest font-semibold">Neutron Flux</div>
                </CardContent>
              </Card>
            </div>

            {/* History Chart */}
            <Card className="bg-zinc-900/50 border-zinc-800 h-64">
              <CardHeader className="py-3 flex flex-row items-center justify-between">
                <CardTitle className="text-xs uppercase tracking-widest text-zinc-500">Performance History</CardTitle>
                <div className="flex gap-4">
                  <div className="flex items-center gap-1 text-[10px] text-emerald-500">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full" /> POWER
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-red-500">
                    <div className="w-2 h-2 bg-red-500 rounded-full" /> TEMP
                  </div>
                </div>
              </CardHeader>
              <CardContent className="h-48 pt-0">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history}>
                    <defs>
                      <linearGradient id="colorPower" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorTemp" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="time" hide />
                    <YAxis hide domain={[0, 'auto']} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', fontSize: '10px' }}
                      itemStyle={{ padding: 0 }}
                    />
                    <Area type="monotone" dataKey="power" stroke="#10b981" fillOpacity={1} fill="url(#colorPower)" strokeWidth={2} isAnimationActive={false} />
                    <Area type="monotone" dataKey="temp" stroke="#ef4444" fillOpacity={1} fill="url(#colorTemp)" strokeWidth={2} isAnimationActive={false} />
                    <Area type="monotone" dataKey="pressure" stroke="#3b82f6" fillOpacity={0.1} fill="transparent" strokeWidth={1} strokeDasharray="4 4" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </main>

          {/* Right Panel: Stats & Logs */}
          <aside className="lg:col-span-3 space-y-6">
            <Card className="bg-zinc-900/50 border-zinc-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase tracking-widest text-zinc-400">Generator Output</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 pt-4">
                <div className="text-center p-4 bg-zinc-950 rounded-lg border border-zinc-800 shadow-inner relative overflow-hidden">
                  {!isTurbineLocked ? (
                    <div className="py-2">
                      <div className="text-2xl font-bold text-zinc-600 italic tracking-tighter">DISCONNECTED</div>
                      <div className="text-[10px] text-zinc-500 uppercase font-bold">Turbine Offline</div>
                    </div>
                  ) : (
                    <>
                      <div className="text-4xl font-bold text-emerald-300 tabular-nums">
                        {potentialPower >= 1000 ? (potentialPower / 1000).toFixed(3) : Math.round(potentialPower)}
                      </div>
                      <div className="text-xs text-zinc-400 uppercase font-bold tracking-tighter">
                        {potentialPower >= 1000 ? 'Gigawatts (GW)' : 'Megawatts (MW)'}
                      </div>
                    </>
                  )}
                  
                  {/* Balance Indicator */}
                  {isTurbineLocked && (
                    <div className="mt-2 flex items-center justify-center gap-2">
                      {Math.abs(potentialPower - ((gridLoad / 100) * 1000)) < 10 ? (
                        <span className="text-[8px] px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full border border-emerald-500/30 font-bold">PERFECT MATCH</span>
                      ) : potentialPower > ((gridLoad / 100) * 1000) ? (
                        <span className="text-[8px] px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded-full border border-yellow-500/30 font-bold">OVER-PRODUCING</span>
                      ) : (
                        <span className="text-[8px] px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded-full border border-blue-500/30 font-bold">UNDER-PRODUCING</span>
                      )}
                    </div>
                  )}
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between text-[10px] uppercase tracking-wider text-zinc-400">
                    <span>Efficiency</span>
                    <span>{Math.round(efficiency || 0)}%</span>
                  </div>
                  <Progress 
                    value={efficiency || 0} 
                    className="h-1 [&_[data-slot=progress-track]]:bg-zinc-950 [&_[data-slot=progress-track]]:border [&_[data-slot=progress-track]]:border-zinc-800/50 [&_[data-slot=progress-indicator]]:bg-emerald-400" 
                  />
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800 text-center">
                    <div className="text-lg font-bold text-blue-400">{Math.round((steamPressure || 0) / 10)}%</div>
                    <div className="text-[8px] text-zinc-400 uppercase font-semibold">Turbine RPM</div>
                  </div>
                  <div className={cn(
                    "p-3 bg-zinc-950 rounded-lg border text-center transition-colors",
                    efficiency > 90 ? "border-emerald-900/50" : efficiency > 50 ? "border-yellow-900/50" : "border-red-900/50"
                  )}>
                    <div className={cn(
                      "text-lg font-bold",
                      efficiency > 90 ? "text-emerald-400" : efficiency > 50 ? "text-yellow-500" : "text-red-500"
                    )}>
                      {Math.round(efficiency)}%
                    </div>
                    <div className="text-[8px] text-zinc-400 uppercase font-semibold">Grid Sync</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-zinc-900/50 border-zinc-800 h-[400px] flex flex-col">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                  <ShieldAlert className="w-3 h-3" /> Event Log
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto space-y-2 pt-2 text-[10px]">
                {history.slice().reverse().map((entry, i) => (
                  <div key={i} className="flex gap-2 border-l border-zinc-700 pl-2 py-1">
                    <span className="text-zinc-400 font-medium">[{entry.time.toString().padStart(4, '0')}]</span>
                    {entry.temp > CRITICAL_TEMP ? (
                      <span className="text-red-300 font-bold">WARNING: Core temperature exceeding safety limits ({entry.temp}°C)</span>
                    ) : entry.power > 0 ? (
                      <span className="text-emerald-300 font-medium">INFO: Reactor output stable at {entry.power}MW</span>
                    ) : entry.temp > 300 && controlRods === 100 ? (
                      <span className="text-red-400 font-bold">ALERT: SCRAM INITIATED - EMERGENCY SHUTDOWN</span>
                    ) : (
                      <span className="text-zinc-300">INFO: Reactor in standby mode</span>
                    )}
                  </div>
                ))}
                {history.length === 0 && (
                  <div className="text-zinc-600 italic">Waiting for system start...</div>
                )}
              </CardContent>
            </Card>
          </aside>

        </div>

        {/* Footer Info */}
        <footer className="flex justify-between items-center text-[10px] text-zinc-600 uppercase tracking-[0.3em] pt-8 border-t border-zinc-800">
          <div>Operator: {isRunning ? 'ACTIVE' : 'IDLE'}</div>
          <div className="flex gap-6">
            <span>Safety Protocol: 10-A</span>
            <span>Region: EU-WEST-1</span>
          </div>
        </footer>
      </div>

      {/* Help Dialog */}
      <AlertDialog open={showHelp} onOpenChange={setShowHelp}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-bold text-emerald-500 flex items-center gap-2">
              <HelpCircle className="w-6 h-6" /> REACTOR OPERATOR MANUAL
            </AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400 text-sm space-y-4">
              <div className="space-y-2">
                <h4 className="font-bold text-zinc-200 uppercase tracking-wider">1. Control Rods</h4>
                <p>
                  Control rods absorb neutrons to regulate the reaction. Inserted at <strong>100%</strong>, they stop fission. 
                  Withdrawing them towards <strong>0%</strong> increases neutron flux and heat generation.
                </p>
              </div>
              
              <div className="space-y-2">
                <h4 className="font-bold text-zinc-200 uppercase tracking-wider">2. Thermal Management</h4>
                <p>
                  Heat must be removed from the core via <strong>Primary Coolant</strong>. This heat is then transferred to the 
                  <strong>Secondary Loop</strong> to generate steam. Use the Secondary Loop to regulate steam pressure and prevent 
                  over-pressurization of the turbines.
                </p>
              </div>

              <div className="space-y-2">
                <h4 className="font-bold text-zinc-200 uppercase tracking-wider">3. Turbine Synchronization</h4>
                <p>
                  The turbine does not connect automatically. You must reach a steam pressure of at least <strong>200 PSI</strong> 
                  before activating <strong>SYNC TO GRID</strong>. If pressure drops below <strong>150 PSI</strong>, 
                  the turbine will automatically disconnect (Trip) for safety.
                </p>
              </div>

              <div className="space-y-2">
                <h4 className="font-bold text-zinc-200 uppercase tracking-wider">4. Efficiency & Fuel</h4>
                <p>
                  Total energy is measured in <strong>Gigawatt-hours (GWh)</strong>. Maximize output by matching 
                  <strong>Grid Demand</strong>. Note that <strong>Efficiency</strong> decreases proportionally as nuclear fuel is depleted.
                </p>
              </div>

              <div className="space-y-2">
                <h4 className="font-bold text-zinc-200 uppercase tracking-wider">5. Safety & SCRAM</h4>
                <p>
                  Temperatures above 850°C damage the <strong>Containment Vessel</strong>. Above 1000°C, a meltdown occurs. 
                  In an emergency, use <strong>SCRAM</strong> for immediate rod insertion and turbine disconnection.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setShowHelp(false)} className="bg-zinc-100 text-zinc-900 hover:bg-zinc-200">
              UNDERSTOOD
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Game Over Dialog */}
      <AlertDialog open={showGameOver}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
          <AlertDialogHeader>
            <AlertDialogTitle className={cn(
              "text-2xl font-bold flex items-center gap-2",
              isMeltdown ? "text-red-500" : "text-emerald-500"
            )}>
              {isMeltdown ? (
                <><AlertTriangle className="w-8 h-8" /> CATASTROPHIC MELTDOWN</>
              ) : (
                <><Zap className="w-8 h-8" /> MISSION COMPLETE</>
              )}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              {isMeltdown ? (
                vesselIntegrity <= 0 ? (
                  "The Primary Containment Vessel has suffered a catastrophic structural failure due to prolonged thermal stress. Radioactive materials have been released into the atmosphere."
                ) : (
                  "The core temperature exceeded 1000°C, causing a breach in the containment vessel. Automatic safety systems have contained the incident, but the reactor core requires complete decommissioning."
                )
              ) : (
                "The nuclear fuel has been completely depleted. The reactor has been safely shut down after a successful generation cycle."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-6 space-y-4">
            <div className="flex justify-between items-center p-4 bg-zinc-950 rounded-lg border border-zinc-800">
              <span className="text-sm text-zinc-400">Final Score</span>
              <span className="text-2xl font-bold text-emerald-400">{Math.floor((score || 0) * 10000).toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center p-4 bg-zinc-950 rounded-lg border border-zinc-800">
              <span className="text-sm text-zinc-400">Total Energy</span>
              <span className="text-2xl font-bold text-zinc-300">{(score || 0).toFixed(4)} GWh</span>
            </div>
            <div className="flex justify-between items-center p-4 bg-zinc-950 rounded-lg border border-zinc-800">
              <span className="text-sm text-zinc-400">Operation Time</span>
              <span className="text-2xl font-bold text-zinc-300">{(time || 0)} cycles</span>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogAction onClick={resetGame} className={cn(
              "text-white",
              isMeltdown ? "bg-red-600 hover:bg-red-500" : "bg-emerald-600 hover:bg-emerald-500"
            )}>
              {isMeltdown ? "RETRY SIMULATION" : "NEW SIMULATION"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
