# RVO Framework Documentation

Welcome to the official documentation for the **Realtime Video Orchestrator (RVO) Proctoring Framework**. This guide provides an in-depth look at the internal mechanics, deployment strategies, and architectural decisions underlying the RVO V2 ecosystem.

## Overview

Traditional computer vision pipelines often run monolithic event loops where camera ingestion, frame resizing, tensor preparation, and inference occur sequentially. This architecture invariably leads to head-of-line blocking: if an inference pass takes 200ms, the camera ingest loop is stalled, resulting in dropped frames and desynchronized audio/video streams.

The **RVO Proctoring Framework** solves this constraint by employing a highly deterministic **Decoupled Inference Architecture**.

### The Decoupled Advantage

At the core of the framework is the **RVO Engine**, written in Rust. The engine operates on a strict 1-millisecond scheduler tick. During this tick, it ingests a frame, pushes it to an internal circular buffer, and instantly writes a reference to a lock-free asynchronous mailbox. 

Simultaneously, a separate cluster of AI workers (operating over a gRPC gateway) retrieves frames from this mailbox and runs heavy workloads (YOLOv8, Haar Cascades) entirely out-of-band. The engine never blocks on inference, ensuring a perfectly stable FPS ingestion rate regardless of the computational complexity of the downstream ML models.

## Documentation Index

Explore the following modules to understand the framework comprehensively:

* **[Architecture & Signal Flow](ARCHITECTURE.md):** 
  Dive into the signal mapping logic. Learn how raw bounding box detections are translated into standardized RVO Event Enums, and how the asynchronous background workers securely bridge the gap between file-system clips and the normalized SQLite database.

* **[Execution & Deployment Guide](RUN_GUIDE.md):** 
  Step-by-step instructions for provisioning the environment, executing the microservices manually for debugging purposes, configuring hardware device indices (Webcam routing), and executing the Continuous Integration pipelines.
