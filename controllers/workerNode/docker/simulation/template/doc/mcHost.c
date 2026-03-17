#include <stdio.h>
#include <stdlib.h>
#include <CL/cl.h>
#include <math.h>

#define MAX_SOURCE_SIZE (0x100000)

char *loadKernel(const char *filename)
{
    FILE *fp = fopen(filename, "r");
    if (!fp) {
        printf("Kernel file not found\n");
        exit(1);
    }

    char *source = (char*)malloc(MAX_SOURCE_SIZE);
    size_t size = fread(source, 1, MAX_SOURCE_SIZE, fp);
    source[size] = '\0';
    fclose(fp);
    return source;
}

int main(int argc, char *argv[])
{
    if (argc < 7) {
        printf("Usage: ./mc runs S0 K r sigma T\n");
        return 1;
    }

    int runs = atoi(argv[1]);
    float S0 = atof(argv[2]);
    float K = atof(argv[3]);
    float r = atof(argv[4]);
    float sigma = atof(argv[5]);
    float T = atof(argv[6]);

    cl_platform_id platform;
    cl_device_id device;
    cl_context context;
    cl_command_queue queue;

    clGetPlatformIDs(1, &platform, NULL);
    clGetDeviceIDs(platform, CL_DEVICE_TYPE_GPU, 1, &device, NULL);

    context = clCreateContext(NULL, 1, &device, NULL, NULL, NULL);
    queue = clCreateCommandQueue(context, device, 0, NULL);

    char *source = loadKernel("mc_kernel.cl");

    cl_program program = clCreateProgramWithSource(context, 1,
        (const char**)&source, NULL, NULL);

    clBuildProgram(program, 1, &device, NULL, NULL, NULL);

    cl_kernel kernel = clCreateKernel(program, "monteCarloOption", NULL);

    float *results = malloc(sizeof(float) * runs);

    cl_mem resultsBuffer = clCreateBuffer(
        context,
        CL_MEM_WRITE_ONLY,
        sizeof(float) * runs,
        NULL,
        NULL
    );

    clSetKernelArg(kernel, 0, sizeof(float), &S0);
    clSetKernelArg(kernel, 1, sizeof(float), &K);
    clSetKernelArg(kernel, 2, sizeof(float), &r);
    clSetKernelArg(kernel, 3, sizeof(float), &sigma);
    clSetKernelArg(kernel, 4, sizeof(float), &T);
    clSetKernelArg(kernel, 5, sizeof(int), &runs);
    clSetKernelArg(kernel, 6, sizeof(cl_mem), &resultsBuffer);

    size_t global = runs;

    clEnqueueNDRangeKernel(queue, kernel, 1, NULL, &global, NULL, 0, NULL, NULL);

    clEnqueueReadBuffer(queue, resultsBuffer, CL_TRUE, 0,
        sizeof(float) * runs, results, 0, NULL, NULL);

    double sum = 0.0;

    for (int i = 0; i < runs; i++)
        sum += results[i];

    double optionPrice = sum / runs;

    printf("Option Price: %f\n", optionPrice);

    clReleaseMemObject(resultsBuffer);
    clReleaseKernel(kernel);
    clReleaseProgram(program);
    clReleaseCommandQueue(queue);
    clReleaseContext(context);

    free(results);

    return 0;
}