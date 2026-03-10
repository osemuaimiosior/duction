#include <stdio.h>
#include <stdlib.h>

int main(int argc, char *argv[]) {

    int runs = atoi(argv[1]);
    float volatility = atof(argv[2]);
    float rate = atof(argv[3]);

    printf("Runs: %d\n", runs);
    printf("Volatility: %f\n", volatility);
    printf("Rate: %f\n", rate);

    // Run OpenCL simulation

}

//Complie code: gcc montecarlo.c -lOpenCL -o montecarlo_opencl