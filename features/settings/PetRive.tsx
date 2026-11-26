"use client";
import {useEffect,useRef,useState} from "react";
import {Rive,Layout,Fit,Alignment} from "@rive-app/canvas";
export default function PetRive({src,fallback,walking=false,interaction=0}:{src:string;fallback:string;walking?:boolean;interaction?:number}){
 const canvas=useRef<HTMLCanvasElement>(null),runtime=useRef<Rive|null>(null);
 const [ready,setReady]=useState(false);
 useEffect(()=>{let live=true;setReady(false);const el=canvas.current;if(!el)return;
 let player:Rive;let observer:ResizeObserver|undefined;
 try{player=new Rive({src,canvas:el,autoplay:true,layout:new Layout({fit:Fit.Contain,alignment:Alignment.Center}),onLoad:()=>{if(!live)return;player.resizeDrawingSurfaceToCanvas();const machine=player.stateMachineNames[0];if(machine)player.play(machine);setReady(true)},onLoadError:()=>{if(live)setReady(false)}});runtime.current=player;observer=new ResizeObserver(()=>player.resizeDrawingSurfaceToCanvas());observer.observe(el);}catch{setReady(false)}
 return()=>{live=false;observer?.disconnect();runtime.current?.cleanup();runtime.current=null};
 },[src]);
 useEffect(()=>{const p=runtime.current;if(!ready||!p)return;const machine=p.stateMachineNames[0];if(!machine)return;const input=p.stateMachineInputs(machine)?.find(i=>i.name==="walking");if(input&&typeof input.value==="boolean")input.value=walking},[ready,walking]);
 useEffect(()=>{const p=runtime.current;if(!ready||!p||!interaction)return;const machine=p.stateMachineNames[0];if(machine)p.stateMachineInputs(machine)?.find(i=>i.name==="tap")?.fire()},[interaction,ready]);
 return <div style={{position:"relative",width:"100%",height:"100%"}}>{!ready&&<img src={fallback} alt="" style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"contain"}}/>}<canvas ref={canvas} aria-hidden="true" style={{width:"100%",height:"100%",display:"block",visibility:ready?"visible":"hidden"}}/></div>
}
